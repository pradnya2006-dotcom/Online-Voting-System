-- Create the database
CREATE DATABASE IF NOT EXISTS online_voting_system;
USE online_voting_system;

-- Create voters table
CREATE TABLE IF NOT EXISTS voters (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    voter_id VARCHAR(10) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    has_voted BOOLEAN DEFAULT FALSE
);

-- Create candidates table
CREATE TABLE IF NOT EXISTS candidates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    votes INT DEFAULT 0
);

-- Insert initial candidates
INSERT INTO candidates (name) VALUES ('Candidate 1') ON DUPLICATE KEY UPDATE name=name;
INSERT INTO candidates (name) VALUES ('Candidate 2') ON DUPLICATE KEY UPDATE name=name;
INSERT INTO candidates (name) VALUES ('Candidate 3') ON DUPLICATE KEY UPDATE name=name;
