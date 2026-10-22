// Who people are: name and email as SuccessFactors had them at each
// person's last sign-in (the employees table), combined with the roster in
// roles.js. Used to address approval emails.
const { pool } = require('./db');
const { employeesWithRole } = require('./roles');

async function rememberEmployee({ employeeId, name, email }) {
  await pool.query(
    `INSERT INTO employees (employee_id, name, email, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (employee_id) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, employees.name),
       email = COALESCE(EXCLUDED.email, employees.email),
       updated_at = now()`,
    [employeeId, name || null, email || null]
  );
}

// Everyone on the roster holding `role` (but not `except`), as
// [{ employeeId, name, email }]. An email given in roles.js wins over the
// one from SuccessFactors; email is null for someone with neither (they
// haven't signed in since this was added, or SF holds no address).
async function recipientsWithRole(role, { except = null } = {}) {
  const people = employeesWithRole(role).filter((p) => p.employeeId !== except);
  if (!people.length) return [];
  const { rows } = await pool.query(
    'SELECT employee_id, name, email FROM employees WHERE employee_id = ANY($1)',
    [people.map((p) => p.employeeId)]
  );
  const known = new Map(rows.map((r) => [r.employee_id, r]));
  return people.map((p) => {
    const k = known.get(p.employeeId);
    return { employeeId: p.employeeId, name: k?.name || p.name, email: p.email || k?.email || null };
  });
}

module.exports = { rememberEmployee, recipientsWithRole };
