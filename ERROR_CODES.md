# Error codes

Every error in the portal shows a code and where it happened, e.g.

> The effective date cannot be earlier than the last confirmed price (05.09.2026).
> Error DSL-003 · Enter diesel price › Effective date

The letters say which screen or step the error came from; the text after `›` names the field to fix.

| Prefix | Where |
|---|---|
| AUTH | Sign in / permissions |
| DSL | Enter diesel price |
| UPL | Notification attachment |
| VND | Select vendors |
| REV | Review before / after |
| APR | Approve and release |
| MD | Master data |
| CR | Master data requests (approval) |
| LKP | Rate lookup |
| ALR | Notifications |
| NET | Connection to the portal |
| SYS | Unexpected server error |

| Code | Meaning | What to do |
|---|---|---|
| AUTH-001 | Not signed in, or session ended (logout, 60 min inactive, or 10 h) | Sign in again |
| AUTH-002 | Employee ID or password missing | Enter both |
| AUTH-003 | Employee ID or password incorrect | Re-enter credentials |
| AUTH-004 | SuccessFactors unreachable at sign in | Try again shortly |
| AUTH-005 | Your account lacks the role this action needs (e.g. only a Rate Approver adds destinations and vehicle types) | Ask for the role in `server/roles.js` |
| AUTH-006 | Your role was removed while you were signed in | Sign in again |
| AUTH-007 | A role was already chosen for this session | Log out and sign in to use another role |
| DSL-001 | Diesel price missing or not above zero | Enter the price |
| DSL-002 | Effective date not DD.MM.YYYY | Correct the date |
| DSL-003 | Effective date earlier than the last confirmed price | Use a later date |
| DSL-004 | Notification not attached | Attach it and wait for the upload |
| DSL-005 | Draft could not be saved (empty or malformed) | Re-enter the details and save again |
| UPL-001 | File is not PDF / JPG / PNG | Attach one of those formats |
| UPL-002 | No file received | Choose the file again |
| UPL-003 | File over 10 MB | Attach a smaller copy |
| UPL-004 | Attachment not found | Re-upload it |
| UPL-005 | Upload failed on the server | Try again |
| VND-001 | No vendor selected | Tick at least one vendor |
| VND-002 | "Rates effective from" missing or not DD.MM.YYYY | Correct the date |
| VND-003 | Vendor not found (possibly deleted) | Reload and reselect |
| REV-001 | Another revision is already pending approval | Wait for it to be decided |
| REV-002 | Some lines have no rate | Type a rate under "New rates" for the vendors named |
| APR-001 | Revision no longer pending | Reload — someone already acted on it |
| APR-002 | Approver is the submitter | Another approver must release it |
| APR-003 | Confirmation password incorrect | Re-enter your SAP password |
| APR-004 | Rejection reason missing | Enter a reason |
| APR-005 | Corrections for a return missing | List what needs to change |
| APR-006 | SuccessFactors unreachable during approval | Try again shortly |
| MD-001 | Pass-through % outside 0–100 | Correct the value |
| MD-002 | Unknown rounding rule | Pick from the list |
| MD-003 | Validity date not DD.MM.YYYY | Correct the date |
| MD-004 | "Valid to" earlier than "Valid from" | Correct the dates |
| MD-005 | Vendor name missing | Enter it |
| MD-006 | New vendor needs a first destination and vehicle type | Enter both |
| MD-007 | Destination name missing | Enter it |
| MD-008 | Wrong number of base rates | One per vehicle type / destination (blank allowed) |
| MD-009 | Destination already on the rate sheet | Use the existing row |
| MD-010 | Destination no longer on the rate sheet | Reload |
| MD-011 | Vehicle type name missing | Enter it |
| MD-012 | Vehicle type already on the rate sheet | Use the existing column |
| MD-013 | Invalid base rate (negative or not a number) | Enter whole rupees or leave blank |
| MD-014 | Vendor name already exists | Use a different name |
| CR-001 | Request not found or already decided | Reload |
| CR-002 | Requester tried to decide their own request | Another approver must decide |
| CR-003 | Vendor is in a revision waiting for approval (also blocks adding a destination or vehicle type) | Decide that revision first |
| CR-004 | Reason missing (deletion or rejection) | Enter a reason |
| CR-005 | Same request already waiting | Wait for the existing one |
| CR-006 | Unknown request type | Report it (should not happen from the screens) |
| LKP-001 | Destination missing in lookup | Enter part of the name |
| LKP-002 | Lookup date not DD.MM.YYYY | Correct or clear the date |
| LKP-003 | Revision does not exist | Pick one from the list |
| ALR-001 | Notification no longer exists | Reload |
| NET-001 | Browser could not reach the portal server | Check the connection |
| SYS-500 | Unexpected server error; the message says what was being done | Retry; if it persists, report the code, message and time |
