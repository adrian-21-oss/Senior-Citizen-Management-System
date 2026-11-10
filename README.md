# 🏛️ Senior Citizen Management System (SCMS)



## 🚀 Tech Stack
* **Frontend:** HTML5, CSS3, JavaScript 
* **Backend:** Node.js, Express.js
* **Database:** PostgreSQL 

---

## 📂 Project Structure
```text
Senior-Citizen-Management-System/
├── public/                 # Frontend UI static files (HTML, CSS, JS)
│   └── index.html          # Main dashboard / registration entry
├── .env                    # Environment variables (Database secrets - DO NOT COMMIT)
├── package.json            # Node.js dependencies and scripts
└── server.js               # Main Express backend API entry point


Local Development Setup
Follow these steps to get the project running on your local machine:

1. Clone & Navigate to the Repository

How to clone 
git clone [https://github.com/adrian-21-oss/Senior-Citizen-Management-System.git](https://github.com/adrian-21-oss/Senior-Citizen-Management-System.git)
cd Senior-Citizen-Management-System

example: git clone https://github.com/adrian-21-oss/Senior-Citizen-Management-System.git


2. Install Dependencies
Make sure you have Node.js installed, then run:

Bash
npm install


3. Set Up PostgreSQL Database
Open your PostgreSQL client (pgAdmin or terminal).

Create the database:

SQL
CREATE DATABASE scms_db;

or you can directly right click and create a new database with a name -> scms_db






Copy this SQL

-- =====================================================-- Senior Citizen Management System (SCMS)-- PostgreSQL schema - based on Data Dictionary v1.1-- Group 4-- =====================================================-- Run this on a fresh database. To start over, uncomment the next line:-- DROP SCHEMA public CASCADE; CREATE SCHEMA public;-- ------------------------------------------------------- 1. ADMIN_USER-- ----------------------------------------------------
CREATE TABLE admin_user (
    admin_id       SERIAL        PRIMARY KEY,
    full_name      VARCHAR(100)  NOT NULL,
    username       VARCHAR(30)   NOT NULL UNIQUE,
    password_hash  VARCHAR(255)  NOT NULL,
    role           VARCHAR(30)   NOT NULL
                   CHECK (role IN ('Admin', 'Registration Staff', 'Benefits Staff')),
    status         VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE', 'INACTIVE'))
				   
);



-- ------------------------------------------------------- 2. SENIOR_CITIZEN-- senior_id is auto-generated like SC-2026-00001-- ----------------------------------------------------
CREATE SEQUENCE senior_id_seq START 1;


CREATE TABLE senior_citizen (
    senior_id               VARCHAR(15)   PRIMARY KEY
                            DEFAULT ('SC-' || to_char(CURRENT_DATE, 'YYYY') || '-' ||
                                     lpad(nextval('senior_id_seq')::text, 5, '0')),
    first_name              VARCHAR(50)   NOT NULL,
    middle_name             VARCHAR(50),
    last_name               VARCHAR(50)   NOT NULL,
    sex                     VARCHAR(10)   NOT NULL
                            CHECK (sex IN ('Male', 'Female')),
    date_of_birth           DATE          NOT NULL,   -- 60+ rule is checked in the app
    civil_status            VARCHAR(20)   NOT NULL,
    national_id             VARCHAR(30),              -- optional (OSCA ID / Barangay Clearance also OK)
    mobile_number           CHAR(11)                  -- optional (some seniors have no phone)
                            CHECK (mobile_number ~ '^[0-9]{11}$'),
    email                   VARCHAR(100),
    street_address          VARCHAR(100)  NOT NULL,
    barangay                VARCHAR(50)   NOT NULL,
    city_municipality       VARCHAR(50)   NOT NULL,
    emergency_contact       VARCHAR(100)  NOT NULL,
    emergency_relationship  VARCHAR(30),
    status                  VARCHAR(10)   NOT NULL DEFAULT 'Active'
                            CHECK (status IN ('Active', 'Inactive', 'Deceased')),
    notes                   TEXT,
    registered_on           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_updated            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP	
);



-- ------------------------------------------------------- 3. FINGERPRINT-- template_data stays empty while enrollment_status = 'Pending'-- ----------------------------------------------------
CREATE TABLE fingerprint (
    fingerprint_id     SERIAL       PRIMARY KEY,
    senior_id          VARCHAR(15)  NOT NULL REFERENCES senior_citizen (senior_id),
    template_data      BYTEA,                         -- filled after a successful scan
    finger_used        VARCHAR(20),                   -- optional, e.g. Right Index

    enrollment_status  VARCHAR(10)  NOT NULL DEFAULT 'Pending'
                       CHECK (enrollment_status IN ('Pending', 'Enrolled')),
    enrolled_on        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- an 'Enrolled' record must have a template
    CONSTRAINT enrolled_needs_template
        CHECK (enrollment_status <> 'Enrolled' OR template_data IS NOT NULL)

		
);

-- ------------------------------------------------------- 4. BENEFIT-- ----------------------------------------------------
CREATE TABLE benefit (
    benefit_id          SERIAL         PRIMARY KEY,
    benefit_name        VARCHAR(50)    NOT NULL,
    period_description  VARCHAR(50)    NOT NULL,
    benefit_year        INTEGER        NOT NULL,
    amount              NUMERIC(10,2)  NOT NULL CHECK (amount > 0),
    -- lets benefit_transaction make sure its year matches the benefit's year
    CONSTRAINT benefit_id_year_unique UNIQUE (benefit_id, benefit_year)
);


-- ------------------------------------------------------- 5. BENEFIT_TRANSACTION-- ----------------------------------------------------
CREATE TABLE benefit_transaction (
    transaction_id   SERIAL         PRIMARY KEY,
    senior_id        VARCHAR(15)    NOT NULL REFERENCES senior_citizen (senior_id),
    benefit_id       INTEGER        NOT NULL,
    benefit_year     INTEGER        NOT NULL,
    admin_id         INTEGER        NOT NULL REFERENCES admin_user (admin_id),
    claim_status     VARCHAR(10)    NOT NULL DEFAULT 'Available'
                     CHECK (claim_status IN ('Available', 'Claimed')),
    amount_released  NUMERIC(10,2)  NOT NULL CHECK (amount_released >= 0),
    released_on      TIMESTAMP,
    -- benefit_year must match the year of that benefit
    CONSTRAINT fk_transaction_benefit
        FOREIGN KEY (benefit_id, benefit_year)
        REFERENCES benefit (benefit_id, benefit_year),
    -- no duplicate claims: same senior + same benefit + same year
    CONSTRAINT unique_senior_benefit_claim
        UNIQUE (senior_id, benefit_id, benefit_year)
);-- ------------------------------------------------------- 6. AUDIT_LOG-- ----------------------------------------------------



CREATE TABLE audit_log (
    log_id           SERIAL        PRIMARY KEY,
    admin_id         INTEGER       NOT NULL REFERENCES admin_user (admin_id),
    senior_id        VARCHAR(15)   REFERENCES senior_citizen (senior_id),
    action_type      VARCHAR(30)   NOT NULL
                     CHECK (action_type IN ('Login', 'Logout', 'Register Senior',
                                            'Biometric Enrollment', 'Update Profile',
                                            'Process Benefit', 'Generate Report')),
    description      VARCHAR(200)  NOT NULL,
    result_status    VARCHAR(10)   NOT NULL
                     CHECK (result_status IN ('Success', 'Failed')),
    action_datetime  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);-- =====================================================-- SAMPLE DATA (for testing only - delete if not needed)-- =====================================================




INSERT INTO admin_user (full_name, username, password_hash, role) VALUES
    ('Admin One',          'admin1', 'REPLACE_WITH_HASHED_PASSWORD', 'Admin'),
    ('Registration Staff', 'regstaff', 'REPLACE_WITH_HASHED_PASSWORD', 'Registration Staff'),
    ('Benefits Staff',     'benstaff', 'REPLACE_WITH_HASHED_PASSWORD', 'Benefits Staff');
INSERT INTO benefit (benefit_name, period_description, benefit_year, amount) VALUES
    ('Social Pension',          'Q3 (July - September)', 2026, 1500.00),
    ('City Birthday Cash Gift', 'Annual Allocation',     2026, 1000.00),
    ('Mid-Year Financial Aid',  '2026 Special Stipend',  2026, 1000.00);
INSERT INTO senior_citizen
    (first_name, middle_name, last_name, sex, date_of_birth, civil_status,
     street_address, barangay, city_municipality, emergency_contact, emergency_relationship)
VALUES
    ('Maria', 'Largo', 'Santos', 'Female', '1958-03-14', 'Widowed',
     '12 Mabini Street', 'Poblacion', 'San Fernando', 'Ana Santos', 'Daughter');
	 -- Quick test: a second claim of the same benefit/year for the same senior will fail
	 -- INSERT INTO benefit_transaction (senior_id, benefit_id, benefit_year, admin_id, claim_status,
    --amount_released, released_on)
	
	-- VALUES ('SC-2026-00001', 1, 2026, 3, 'Claimed', 1500.00, CURRENT_TIMESTAMP)




4. Configure Environment Variables
Create a .env file (if not exists) in the root project folder and add your local PostgreSQL credentials:

Code snippet

PORT=5000
DB_USER=postgres
DB_HOST=localhost
DB_NAME=scms_db
DB_PASSWORD=your_actual_postgres_password
DB_PORT=5432




5. Run the Application
Development Mode (with auto-reload):

Bash
npm run dev
Production / Final Run Mode:

Bash
npm start



http://localhost:5000/





🔀 Git Workflow & Collaboration Guidelines
Pull Before You Push: Always pull the latest changes from GitHub before starting your work to avoid conflicts:

Bash
git pull origin main
Commit Messages: Write clear, descriptive commit messages:

Bash
git commit -m "Added benefit ledger UI elements and validation routes"
Sensitive Data: Never commit your .env file or hardcode database passwords. Keep local secrets local!
