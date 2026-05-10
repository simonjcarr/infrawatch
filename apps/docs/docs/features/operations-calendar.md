# Operations Calendar

Operations Calendar is a shared planning calendar for maintenance windows, patching, application work, and operational events.

It is separate from Scheduled Tasks. Calendar events do not dispatch agent tasks or patch jobs; they record the planned work, linked hosts, and participating users.

## Views

The calendar supports Outlook-style:

| View | Use |
|---|---|
| Day | Detailed schedule for one day |
| Work Week | Monday to Friday planning |
| Full Week | Seven-day maintenance coverage |
| Month | Medium-range event planning |
| Year | Annual maintenance and change visibility |

## Events

An event can include:

- Title and description
- Start and end time
- All-day flag
- Timezone
- Status and category
- Linked hosts
- Linked users with change-control-style roles

Participant roles are informational in this version. They do not enforce approval gates.

## Recurring Events

Recurring events support daily, weekly, monthly, and yearly patterns. Individual occurrences can be moved without moving the full series; CT-Ops stores that as an occurrence exception.

Deleting or editing the whole series affects the parent recurring event.

## Permissions

| Role | View | Create / Edit / Delete |
|---|---:|---:|
| `super_admin` | ✅ | ✅ |
| `org_admin` | ✅ | ✅ |
| `engineer` | ✅ | ✅ |
| `read_only` | ✅ | ❌ |

All writes are validated on the server, scoped to the user's CT-Ops instance, rate-limited, and recorded in the audit log.
