CREATE TABLE attendance (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(7) NOT NULL,
    punch_in TIMESTAMP NOT NULL,
    punch_out TIMESTAMP,
    hours_worked DECIMAL(4,2),
    status VARCHAR(10) NOT NULL,
    attendance_status VARCHAR(20),
    CONSTRAINT valid_employee_id CHECK (
        employee_id ~ '^ATS0[0-9]{3}$'
        AND employee_id NOT LIKE '% %'
        AND employee_id != 'ATS0000'
    ),
    CONSTRAINT valid_status CHECK (status IN ('in', 'out'))
);


CREATE INDEX idx_employee_id ON attendance(employee_id);
CREATE INDEX idx_punch_in_date ON attendance(DATE(punch_in));
