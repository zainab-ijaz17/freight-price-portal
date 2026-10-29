// Employee ID -> assigned role(s). The SuccessFactors login check (see
// sfClient.js) only confirms the employee ID / password pair; it doesn't
// return a role, so role assignment for this app has to live here instead
// of being picked by the user at login. Anyone who authenticates but isn't
// listed gets 'Display' (view-only) rather than being rejected.
//
// Everyone gets exactly one role except where `roles` lists more than
// one — that's a pick-a-role account (screens/login.js prompts for which
// one to use for the session) rather than a normal single-role assignment.
//
// The Rate Approver also holds what used to be the separate Administrator
// role: agreement terms, base rates, and raising new-vendor / deletion
// requests (which another approver then decides).
//
// `name` is only a fallback: the name shown in the portal comes from
// SuccessFactors at sign-in (see sfClient.js). `email` is optional — when
// left out, approval emails go to the address SuccessFactors holds for
// that person (saved at their last sign-in, see directory.js).
const ALL_ROLES = ['Rate Maintainer', 'Approver', 'Display'];
const DEFAULT_ROLE = 'Display';

// Live roster. Keep at least two Approvers, so a master data request or
// revision raised by one approver can still be decided by someone else.
const ROSTER = {
  '20005702': { name: 'Imran Nisar', roles: ['Rate Maintainer'] },
  '20003559': { name: 'Ghulam Hussain', roles: ['Rate Maintainer'] },
  '10009732': { name: 'Farhan Amin', roles: ['Approver'] },
};

// All-roles accounts for testing only. Off unless ENABLE_TEST_ACCOUNTS=true
// — never set that on the live system: one person holding every role
// defeats the maker/approver separation.
const TEST_ACCOUNTS = {
  '10009654': { name: '10009654', roles: ALL_ROLES },
  '10009760': { name: '10009760', roles: ALL_ROLES },
};

function roster() {
  return process.env.ENABLE_TEST_ACCOUNTS === 'true' ? { ...ROSTER, ...TEST_ACCOUNTS } : ROSTER;
}

function assignmentFor(employeeId) {
  return roster()[employeeId] || { name: employeeId, roles: [DEFAULT_ROLE] };
}

// Everyone on the roster holding `role`, as [{ employeeId, name, email }].
function employeesWithRole(role) {
  return Object.entries(roster())
    .filter(([, a]) => a.roles.includes(role))
    .map(([employeeId, a]) => ({ employeeId, name: a.name, email: a.email || null }));
}

if (process.env.ENABLE_TEST_ACCOUNTS === 'true') {
  console.warn('WARNING: ENABLE_TEST_ACCOUNTS is on — all-roles test accounts can sign in. Do not use on the live system.');
}

module.exports = { assignmentFor, employeesWithRole };
