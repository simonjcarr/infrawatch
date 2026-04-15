# Notifications

Infrawatch supports multiple notification channels. Each alert rule specifies which channels its notifications are routed to.

---

## Notification Channels

### In-app (notification bell)

All notifications appear in the in-app notification bell in the top navigation bar. The bell shows an unread count badge. Clicking it opens the notifications panel with:
- Severity icon (info / warning / critical)
- Alert name and affected host
- Timestamp
- Link to the alert detail

In-app notifications cannot be disabled — they are always generated.

### Slack

Posts a formatted message to a Slack channel via an Incoming Webhook URL.

**Setup:**
1. Navigate to **Settings → Notification Channels**
2. Click **New Channel → Slack**
3. Paste your Slack Incoming Webhook URL
4. Optionally set a channel override (e.g. `#alerts-critical`)
5. Click **Test** to send a test notification
6. Click **Save**

### Email (SMTP)

Sends an HTML email via your SMTP server.

**Setup:**
1. Navigate to **Settings → Notification Channels**
2. Click **New Channel → Email**
3. Fill in SMTP host, port, username, password, and sender address
4. Enter one or more recipient addresses
5. Click **Test** to send a test email
6. Click **Save**

### Webhook

POSTs a JSON payload to any HTTP endpoint.

**Payload format:**

```json
{
  "alert_id": "clxyz...",
  "rule_name": "High CPU",
  "severity": "critical",
  "host": "web-01.corp.example.com",
  "condition": "cpu_percent > 90",
  "value": 94.3,
  "fired_at": "2024-01-15T14:32:00Z"
}
```

### Telegram

Sends a message to a Telegram chat via the Bot API.

**Setup:**
1. Create a bot via @BotFather and copy the bot token
2. Get your chat ID (send a message to your bot and query the API)
3. Navigate to **Settings → Notification Channels → New Channel → Telegram**
4. Enter the bot token and chat ID
5. Click **Test** then **Save**

---

## Managing Notifications

### Marking as read / unread

Click the notification in the bell panel to mark it as read. **Mark all as read** is available at the top of the panel.

### Bulk actions

The full **Notifications** page (`/notifications`) supports:
- Multi-select with bulk mark-as-read
- Bulk delete (soft-delete — record retained for audit)
- Filter by severity, status (read/unread), or date range

### Notification charts

The notifications page includes:
- **Severity breakdown** pie chart — proportion of info / warning / critical over the selected time range
- **Trend chart** — notification volume over time

These help identify whether noise is increasing or decreasing and which rules are most active.

---

## Notification Retention

Notifications are soft-deleted (marked with `deleted_at`) rather than permanently removed. A background purge job runs periodically to clean up old soft-deleted records. The retention period is configurable in **Settings → System**.
