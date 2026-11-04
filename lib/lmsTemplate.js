// The LMS "user import" template (user-import-template.xlsx), copied from the file the LMS team gave.
// If the LMS changes its template, change the headings / instructions here and nothing else.
export const LMS_HEADERS = ["Employee Code", "Email", "First Name", "Last Name", "Phone", "Department", "Designation", "Roles", "Manages Departments", "Joining Date"];

// Mandatory columns (Required = Yes on the template's Instructions sheet)
export const LMS_REQUIRED = ["Email", "First Name", "Last Name", "Roles"];

// The template's Instructions sheet, row by row: Column | Required | Example | Notes
export const LMS_INSTRUCTIONS = [
  [
    "Column",
    "Required",
    "Example",
    "Notes"
  ],
  [
    "Employee Code",
    "No",
    "PP-1024",
    "Optional. Must be unique where given. Leave blank for anyone without one — their temporary password is then Firstname@123."
  ],
  [
    "Email",
    "Yes",
    "rahul.sharma@petpooja.com",
    "Work email. Must be unique."
  ],
  [
    "First Name",
    "Yes",
    "Rahul",
    ""
  ],
  [
    "Last Name",
    "Yes",
    "Sharma",
    ""
  ],
  [
    "Phone",
    "No",
    "+91 98765 43210",
    ""
  ],
  [
    "Department",
    "No",
    "Operations",
    "The department this person belongs to, by name. A department that does not exist yet is created."
  ],
  [
    "Designation",
    "No",
    "Team Lead",
    "Job title, by name. A designation that does not exist yet is created."
  ],
  [
    "Roles",
    "Yes",
    "Employee",
    "One or more role names, comma separated. e.g. \"Employee\" or \"Manager, Employee\". Roles are never created — they must already exist."
  ],
  [
    "Manages Departments",
    "No",
    "Engineering, Quality",
    "Only for managers. Comma-separated department names this person manages. Different from the department they belong to."
  ],
  [
    "Joining Date",
    "No",
    "2026-04-01",
    "Format YYYY-MM-DD."
  ],
  [
    "",
    "",
    "",
    ""
  ],
  [
    "",
    "",
    "",
    "Enter your data from row 2 onward on the \"Data\" sheet."
  ],
  [
    "",
    "",
    "",
    "Maximum 5,000 rows per upload."
  ]
];

export const LMS_MAX_ROWS = 5000; // "Maximum 5,000 rows per upload."
