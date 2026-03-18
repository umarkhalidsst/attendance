# Attendance + WhatsApp Alerts

A simple web app that lets you:

- Load student data from an Excel file (classes = worksheets)
- Mark absent students (default is present)
- Send a ready-made WhatsApp message to parents when a student is absent
- Let a principal message any class/student and a teacher message only the assigned class

## Getting started

### 1) Install dependencies

```bash
npm install
```

### 2) Start the server

```bash
npm start
```

Then open http://localhost:3000 in your browser.

## How to use

### Sign in / access control

- When you open the app, you must first **sign in**.
- There is a built-in **admin** account (you) that can **approve principals**.
  - Default admin password: `admin123` (change it in `public/app.js` if needed).
- Principals must **request access** (sign up) and then you (admin) must **approve** them.
- Principal sign-up now requires:
  - **School name**
  - **Principal name**
  - **Phone number**
  - **Email**
  - **Password**
- Once approved, a principal can log in and upload their school sheet and manage teachers.

### Load student data

- **Excel:** Upload an `.xlsx` or `.xls` file where each worksheet is a class.

Your sheet should have columns like:

- `Roll`, `roll`, `Roll #`
- `Name`, `Student`, `Student Name`
- `Father`, `Father's Name`, `Father Name`
- `Phone`, `ParentPhone`, `Phone Number`

Phone formats supported:
- `+923001234567`
- `03001234567`
- `3001234567`

### Roles

- **Principal:** Can pick any class and send messages to any students.
- **Teacher:** Can only send messages to their assigned class.

### WhatsApp messages

- Mark a student as *Absent* to reveal a WhatsApp button.
- Use the message template to craft your message.
- Clicking the button opens WhatsApp Web/mobile with the pre-filled message.

---

## Notes

- The app uses WhatsApp Web links (`wa.me`). It does not send messages automatically; you must confirm on WhatsApp.
- For Google Sheets, the sheet must be publicly readable ("Anyone with the link" can view).
