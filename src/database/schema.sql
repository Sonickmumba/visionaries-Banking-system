-- Village Banking Database Schema
-- Migration 001: Create initial schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    role VARCHAR(20) NOT NULL CHECK (role IN ('super_admin', 'admin', 'member')),
    address TEXT,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on email for faster lookups
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);

-- Create cycles table
CREATE TABLE IF NOT EXISTS cycles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    current_month INTEGER DEFAULT 1,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    config JSONB NOT NULL,
    member_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cycles_status ON cycles(status);
CREATE INDEX idx_cycles_dates ON cycles(start_date, end_date);

-- Create members table (links users to cycles)
CREATE TABLE IF NOT EXISTS members (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    cycle_id INTEGER REFERENCES cycles(id) ON DELETE CASCADE,
    joined_date DATE NOT NULL,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'exited')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, cycle_id)
);

CREATE INDEX idx_members_cycle ON members(cycle_id);

-- Create savings table
CREATE TABLE IF NOT EXISTS savings (
    id SERIAL PRIMARY KEY,
    member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
    cycle_id INTEGER REFERENCES cycles(id) ON DELETE CASCADE,
    month INTEGER NOT NULL,
    principal_deposit DECIMAL(15, 2) NOT NULL DEFAULT 0,
    total_principal DECIMAL(15, 2) NOT NULL DEFAULT 0,
    savings_interest DECIMAL(15, 2) NOT NULL DEFAULT 0,
    accumulated_savings DECIMAL(15, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(member_id, cycle_id, month)
);

CREATE INDEX idx_savings_member_cycle_month ON savings(member_id, cycle_id, month);
CREATE INDEX idx_savings_cycle_month ON savings(cycle_id, month);

-- Create loans table
CREATE TABLE IF NOT EXISTS loans (
    id SERIAL PRIMARY KEY,
    member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
    cycle_id INTEGER REFERENCES cycles(id) ON DELETE CASCADE,
    loan_type VARCHAR(50) NOT NULL CHECK (loan_type IN ('original', 'top_up', 'emergency', 'common_interest', 'common_interest_pool')),
    amount DECIMAL(15, 2) NOT NULL,
    disbursed_date DATE NOT NULL,
    outstanding_balance DECIMAL(15, 2) NOT NULL,
    monthly_interest DECIMAL(15, 2) NOT NULL DEFAULT 0,
    status VARCHAR(50) DEFAULT 'disbursed' CHECK (status IN ('pending', 'approved', 'disbursed', 'repaid', 'defaulted')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_loans_member_cycle ON loans(member_id, cycle_id);
CREATE INDEX idx_loans_status ON loans(status);
CREATE INDEX idx_loans_disbursed_date ON loans(disbursed_date);


-- Create uploaded_files table for storing file metadata
CREATE TABLE IF NOT EXISTS uploaded_files (
    id SERIAL PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_type VARCHAR(50),
    file_size INTEGER,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_uploaded_files_uploaded_by ON uploaded_files(uploaded_by);
CREATE INDEX idx_uploaded_files_uploaded_at ON uploaded_files(uploaded_at);


-- Create loan_repayments table
CREATE TABLE IF NOT EXISTS loan_repayments (
    id SERIAL PRIMARY KEY,
    loan_id INTEGER REFERENCES loans(id) ON DELETE CASCADE,
    member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
    cycle_id INTEGER REFERENCES cycles(id) ON DELETE CASCADE,
    amount DECIMAL(15, 2) NOT NULL,
    reference_number VARCHAR(100) UNIQUE NOT NULL,
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('mobile_money', 'cash', 'bank_transfer')),
    payment_proof_id INTEGER REFERENCES uploaded_files(id),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP,
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_loan_repayments_loan_id ON loan_repayments(loan_id);
CREATE INDEX idx_loan_repayments_member_id ON loan_repayments(member_id);
CREATE INDEX idx_loan_repayments_status ON loan_repayments(status);

-- Create declarations table
CREATE TABLE IF NOT EXISTS declarations (
    id SERIAL PRIMARY KEY,
    member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
    cycle_id INTEGER REFERENCES cycles(id) ON DELETE CASCADE,
    payment_proof_id INTEGER REFERENCES uploaded_files(id),
    month INTEGER NOT NULL,
    submitted_at TIMESTAMP NOT NULL,
    savings_amount DECIMAL(15, 2) DEFAULT 0,
    loan_request DECIMAL(15, 2) DEFAULT 0,
    principal_repayment DECIMAL(15, 2) DEFAULT 0,
    interest_repayment DECIMAL(15, 2) DEFAULT 0,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP,
    rejection_reason TEXT,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'submitted', 'processed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    -- No unique constraint on (member_id, cycle_id, month): a member may submit multiple
    -- declaration events per month (loan repayments, loan requests). Uniqueness is enforced
    -- in application code per type: savings once per month, one open loan request per cycle.
);


CREATE INDEX idx_declarations_member_cycle_month ON declarations(member_id, cycle_id, month);
CREATE INDEX idx_declarations_cycle_month ON declarations(cycle_id, month);

-- Link repayment records back to their originating declaration.
-- Added after declarations to satisfy FK ordering. Safe to re-run (IF NOT EXISTS).
ALTER TABLE loan_repayments
  ADD COLUMN IF NOT EXISTS declaration_id INTEGER REFERENCES declarations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_loan_repayments_declaration_id ON loan_repayments(declaration_id);

-- Create approvals table for unified tracking and audit trail
CREATE TABLE IF NOT EXISTS approvals (
    id SERIAL PRIMARY KEY,
    approval_type VARCHAR(50) NOT NULL CHECK (approval_type IN ('savings_declaration', 'loan_repayment')),
    entity_id INTEGER NOT NULL,
    member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
    cycle_id INTEGER REFERENCES cycles(id) ON DELETE CASCADE,
    amount DECIMAL(15, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    submitted_by INTEGER REFERENCES users(id),
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_approvals_status ON approvals(status);
CREATE INDEX idx_approvals_type ON approvals(approval_type);
CREATE INDEX idx_approvals_member_id ON approvals(member_id);
CREATE INDEX idx_approvals_cycle_id ON approvals(cycle_id);
CREATE INDEX idx_approvals_submitted_at ON approvals(submitted_at);
CREATE INDEX idx_approvals_type_status ON approvals(approval_type, status);


-- Create penalties table
CREATE TABLE IF NOT EXISTS penalties (
    id SERIAL PRIMARY KEY,
    member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
    cycle_id INTEGER REFERENCES cycles(id) ON DELETE CASCADE,
    month INTEGER NOT NULL,
    penalty_type VARCHAR(100) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    status VARCHAR(50) DEFAULT 'assessed' CHECK (status IN ('assessed', 'paid', 'waived', 'converted_to_loan')),
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_penalties_member_cycle_month ON penalties(member_id, cycle_id, month);
CREATE INDEX idx_penalties_status ON penalties(status);

-- Create common_interest_allocations table
CREATE TABLE IF NOT EXISTS common_interest_allocations (
    id SERIAL PRIMARY KEY,
    member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
    cycle_id INTEGER REFERENCES cycles(id) ON DELETE CASCADE,
    month INTEGER NOT NULL,
    eligibility_status VARCHAR(100) NOT NULL,
    shortfall DECIMAL(15, 2) DEFAULT 0,
    assigned_base DECIMAL(15, 2) DEFAULT 0,
    charge DECIMAL(15, 2) NOT NULL,
    allocation_method VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'allocated' CHECK (status IN ('allocated', 'paid', 'pending')),
    principal_allocated DECIMAL(15, 2) DEFAULT 0,
    pool_loan_id        INTEGER REFERENCES loans(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(member_id, cycle_id, month)
);

CREATE INDEX idx_common_interest_member_cycle_month ON common_interest_allocations(member_id, cycle_id, month);
CREATE INDEX idx_common_interest_cycle_month ON common_interest_allocations(cycle_id, month);

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
    cycle_id INTEGER REFERENCES cycles(id) ON DELETE CASCADE,
    month INTEGER NOT NULL,
    type VARCHAR(100) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    date DATE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transactions_member_cycle ON transactions(member_id, cycle_id);
CREATE INDEX idx_transactions_cycle_month ON transactions(cycle_id, month);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_type ON transactions(type);

-- Audit logs table
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id INTEGER,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create monthly_balances table (summary/snapshot table)
CREATE TABLE IF NOT EXISTS monthly_balances (
    id SERIAL PRIMARY KEY,
    member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
    cycle_id INTEGER REFERENCES cycles(id) ON DELETE CASCADE,
    month INTEGER NOT NULL,
    savings_principal DECIMAL(15, 2) DEFAULT 0,
    accumulated_savings DECIMAL(15, 2) DEFAULT 0,
    outstanding_loan DECIMAL(15, 2) DEFAULT 0,
    cumulative_borrowing DECIMAL(15, 2) DEFAULT 0,
    common_interest_due DECIMAL(15, 2) DEFAULT 0,
    penalties_due DECIMAL(15, 2) DEFAULT 0,
    social_fund_paid BOOLEAN DEFAULT FALSE,
    membership_fee_paid BOOLEAN DEFAULT FALSE,
    compliance_status VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(member_id, cycle_id, month)
);

CREATE INDEX idx_monthly_balances_member_cycle_month ON monthly_balances(member_id, cycle_id, month);
CREATE INDEX idx_monthly_balances_cycle_month ON monthly_balances(cycle_id, month);

-- Create refresh_tokens table for JWT refresh tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- Create trigger function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';


-- Apply updated_at trigger to new tables
CREATE TRIGGER update_loan_repayments_updated_at 
    BEFORE UPDATE ON loan_repayments 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_approvals_updated_at 
    BEFORE UPDATE ON approvals 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function to generate reference numbers
CREATE OR REPLACE FUNCTION generate_reference_number()
RETURNS TEXT AS $$
DECLARE
    new_reference TEXT;
    counter INTEGER;
BEGIN
    -- Get the current count of repayments this year
    SELECT COUNT(*) + 1 INTO counter
    FROM loan_repayments
    WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_TIMESTAMP);
    
    -- Format: REF-YYYY-NNNN
    new_reference := 'REF-' || EXTRACT(YEAR FROM CURRENT_TIMESTAMP) || '-' || LPAD(counter::TEXT, 4, '0');
    
    RETURN new_reference;
END;
$$ LANGUAGE plpgsql;

-- Create materialized view for approval statistics (for performance)
CREATE MATERIALIZED VIEW IF NOT EXISTS approval_stats AS
SELECT 
    cycle_id,
    approval_type,
    status,
    COUNT(*) as count,
    SUM(amount) as total_amount
FROM approvals
GROUP BY cycle_id, approval_type, status;

CREATE INDEX idx_approval_stats_cycle ON approval_stats(cycle_id);
CREATE INDEX idx_approval_stats_type_status ON approval_stats(approval_type, status);

-- Function to refresh approval stats
CREATE OR REPLACE FUNCTION refresh_approval_stats()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY approval_stats;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers to all tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_cycles_updated_at BEFORE UPDATE ON cycles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_members_updated_at BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_savings_updated_at BEFORE UPDATE ON savings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_loans_updated_at BEFORE UPDATE ON loans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_declarations_updated_at BEFORE UPDATE ON declarations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_penalties_updated_at BEFORE UPDATE ON penalties FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_common_interest_updated_at BEFORE UPDATE ON common_interest_allocations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_monthly_balances_updated_at BEFORE UPDATE ON monthly_balances FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
