# EduTrack
EduTrack is a web-based attendance recording system for schools.  
It combines **QR code scanning** (for students with phones) and **manual check-in** (for those without phones).  
Teachers can generate daily QR codes, students scan them to mark presence, and the data is synced to the teacher’s dashboard in real-time.

## Features
**Supabase Auth**
  - Teacher, Student, and Admin roles
  - Secure login for students (no student dashboard required)
**QR Code Attendance**
  - Teacher generates a daily QR code
  - Students scan → system records attendance
**Manual Attendance**
  - Teachers can manually mark students present/absent
**Dashboard for Teachers**
  - View today’s attendance
  - Track present, absent, excused students
**Database (Supabase Postgres)**
  - Stores users, classes, sessions, and attendance records
  - Row-Level Security (RLS) ensures data privacy

## Tech Stack
- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Supabase (Auth, Database, APIs)
- **Database**: PostgreSQL (via Supabase)
- **QR Code**: [QRCode.js](https://github.com/davidshimjs/qrcodejs) (client-side generator)

