const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const app = express();
const port = 3603;

// PostgreSQL connection
const pool = new Pool({
    user: 'postgres',
    host: 'postgres',
    database: 'attendance_db',
    password: 'admin123',
    port: 5432,
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
    console.log(`${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })}: ${req.method} ${req.url}`);
    next();
});

// Validate Employee ID
const validateEmployeeId = (id) => {
    if (!id || id.includes(' ') || id.length !== 7) return false;
    const formatRegex = /^ATS0\d{3}$/;
    if (!formatRegex.test(id) || id.slice(-3) === '000') return false;
    return true;
};

// Punch In
app.post('/api/punch-in', async (req, res) => {
    const { employeeId } = req.body;
    if (!validateEmployeeId(employeeId)) {
        return res.status(400).json({ error: 'Invalid Employee ID' });
    }

    try {
        const today = new Date().toISOString().split('T')[0];
        const checkQuery = `
            SELECT * FROM attendance 
            WHERE employee_id = $1 
            AND DATE(punch_in) = $2
        `;
        const checkResult = await pool.query(checkQuery, [employeeId, today]);

        if (checkResult.rows.length > 0) {
            return res.status(400).json({ error: 'Employee has already punched in today' });
        }

        const insertQuery = `
            INSERT INTO attendance (employee_id, punch_in, status)
            VALUES ($1, CURRENT_TIMESTAMP, 'in')
            RETURNING *
        `;
        const result = await pool.query(insertQuery, [employeeId]);
        res.json({ 
            message: 'Successfully punched in',
            record: result.rows[0]
        });
    } catch (error) {
        console.error('Error punching in:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Punch Out
app.post('/api/punch-out', async (req, res) => {
    const { employeeId } = req.body;
    if (!validateEmployeeId(employeeId)) {
        return res.status(400).json({ error: 'Invalid Employee ID' });
    }

    try {
        const today = new Date().toISOString().split('T')[0];
        const checkQuery = `
            SELECT * FROM attendance 
            WHERE employee_id = $1 
            AND DATE(punch_in) = $2 
            AND status = 'in'
        `;
        const checkResult = await pool.query(checkQuery, [employeeId, today]);

        if (checkResult.rows.length === 0) {
            return res.status(400).json({ error: 'No active punch-in found for today' });
        }

        const hoursWorked = await pool.query(`
            SELECT EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - punch_in)) / 3600 AS hours
            FROM attendance
            WHERE employee_id = $1 AND DATE(punch_in) = $2
        `, [employeeId, today]);

        const hours = parseFloat(hoursWorked.rows[0].hours.toFixed(2));
        let attendanceStatus;
        if (hours >= 8) attendanceStatus = 'Present';
        else if (hours >= 4) attendanceStatus = 'Half Day Present';
        else attendanceStatus = 'Absent';

        const updateQuery = `
            UPDATE attendance 
            SET punch_out = CURRENT_TIMESTAMP,
                status = 'out',
                hours_worked = $1,
                attendance_status = $2
            WHERE employee_id = $3 
            AND DATE(punch_in) = $4
            RETURNING *
        `;
        const result = await pool.query(updateQuery, [hours, attendanceStatus, employeeId, today]);
        res.json({ 
            message: 'Successfully punched out',
            record: result.rows[0]
        });
    } catch (error) {
        console.error('Error punching out:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get Attendance Records
app.get('/api/attendance', async (req, res) => {
    const { tab, employeeId, page = 1, limit = 12 } = req.query;
    const offset = (page - 1) * limit;
    let query = 'SELECT * FROM attendance';
    let countQuery = 'SELECT COUNT(*) FROM attendance';
    const params = [];
    let whereClause = '';

    if (employeeId) {
        whereClause += ' WHERE employee_id = $1';
        params.push(employeeId);
    }

    if (tab !== 'all' && !employeeId) {
        if (tab === 'today') {
            whereClause += whereClause ? ' AND' : ' WHERE';
            whereClause += ' DATE(punch_in) = CURRENT_DATE';
        } else if (tab === 'week') {
            whereClause += whereClause ? ' AND' : ' WHERE';
            whereClause += ' punch_in >= date_trunc(\'week\', CURRENT_DATE)';
        } else if (tab === 'month') {
            whereClause += whereClause ? ' AND' : ' WHERE';
            whereClause += ' punch_in >= date_trunc(\'month\', CURRENT_DATE)';
        }
    }

    try {
        const result = await pool.query(
            `${query}${whereClause} ORDER BY punch_in DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );
        const countResult = await pool.query(`${countQuery}${whereClause}`, params);
        res.json({
            records: result.rows,
            totalRecords: parseInt(countResult.rows[0].count),
            totalPages: Math.ceil(countResult.rows[0].count / limit)
        });
    } catch (error) {
        console.error('Error fetching attendance:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get Stats
app.get('/api/stats', async (req, res) => {
    try {
        const presentQuery = `
            SELECT COUNT(*) as count 
            FROM attendance 
            WHERE attendance_status = 'Present' 
            AND DATE(punch_in) = CURRENT_DATE
        `;
        const halfDayQuery = `
            SELECT COUNT(*) as count 
            FROM attendance 
            WHERE attendance_status = 'Half Day Present' 
            AND DATE(punch_in) = CURRENT_DATE
        `;
        const absentQuery = `
            SELECT COUNT(*) as count 
            FROM attendance 
            WHERE attendance_status = 'Absent' 
            AND DATE(punch_in) = CURRENT_DATE
        `;
        const totalEmployeesQuery = `
            SELECT COUNT(DISTINCT employee_id) as count 
            FROM attendance
        `;

        const [present, halfDay, absent, total] = await Promise.all([
            pool.query(presentQuery),
            pool.query(halfDayQuery),
            pool.query(absentQuery),
            pool.query(totalEmployeesQuery)
        ]);

        res.json({
            present: parseInt(present.rows[0].count),
            halfDay: parseInt(halfDay.rows[0].count),
            absent: parseInt(absent.rows[0].count),
            totalEmployees: parseInt(total.rows[0].count)
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Clear Records
app.delete('/api/attendance', async (req, res) => {
    try {
        await pool.query('DELETE FROM attendance');
        res.json({ message: 'All records cleared successfully' });
    } catch (error) {
        console.error('Error clearing records:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Export to CSV
app.get('/api/export', async (req, res) => {
    const { tab, employeeId } = req.query;
    let query = 'SELECT * FROM attendance';
    const params = [];
    let whereClause = '';

    if (employeeId) {
        whereClause += ' WHERE employee_id = $1';
        params.push(employeeId);
    }

    if (tab !== 'all' && !employeeId) {
        if (tab === 'today') {
            whereClause += whereClause ? ' AND' : ' WHERE';
            whereClause += ' DATE(punch_in) = CURRENT_DATE';
        } else if (tab === 'week') {
            whereClause += whereClause ? ' AND' : ' WHERE';
            whereClause += ' punch_in >= date_trunc(\'week\', CURRENT_DATE)';
        } else if (tab === 'month') {
            whereClause += whereClause ? ' AND' : ' WHERE';
            whereClause += ' punch_in >= date_trunc(\'month\', CURRENT_DATE)';
        }
    }

    try {
        const result = await pool.query(`${query}${whereClause} ORDER BY punch_in DESC`, params);
        let csvContent = 'Employee ID,Date,Punch In,Punch Out,Hours Worked,Attendance Status\n';
        
        result.rows.forEach(row => {
            const punchIn = new Date(row.punch_in).toLocaleString('en-US');
            const punchOut = row.punch_out ? new Date(row.punch_out).toLocaleString('en-US') : 'Not punched out';
            const hours = row.hours_worked ? formatDuration(row.hours_worked) : 'N/A';
            const status = row.attendance_status || 'In Progress';
            csvContent += `${row.employee_id},"${punchIn.split(',')[0]}","${punchIn.split(',')[1]?.trim() || punchIn}","${punchOut.split(',')[1]?.trim() || punchOut}",${hours},${status}\n`;
        });

        res.header('Content-Type', 'text/csv');
        res.attachment(`attendance_${tab}_${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csvContent);
    } catch (error) {
        console.error('Error exporting data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }

    function formatDuration(hoursWorked) {
        if (!hoursWorked) return 'N/A';
        const hours = Math.floor(hoursWorked);
        const minutes = Math.floor((hoursWorked - hours) * 60);
        let result = '';
        if (hours > 0) result += `${hours} hour${hours !== 1 ? 's' : ''}`;
        if (minutes > 0) result += `${hours > 0 ? ', ' : ''}${minutes} minute${minutes !== 1 ? 's' : ''}`;
        return result || '0 minutes';
    }
});

app.listen(port, () => {
    console.log(`Server running at http://3.85.61.23:${port}`);
});