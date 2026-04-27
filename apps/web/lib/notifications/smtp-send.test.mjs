import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'

import { sendSmtpMessage } from './smtp-send.ts'

function startMockSmtpServer() {
  const messages = []
  const server = net.createServer((socket) => {
    let mode = 'command'
    let data = ''
    let current = { from: '', to: [] }

    socket.setEncoding('utf8')
    socket.write('220 mock.smtp ESMTP\r\n')
    socket.on('data', (chunk) => {
      for (const line of chunk.split(/\r\n/)) {
        if (line === '') continue
        if (mode === 'data') {
          if (line === '.') {
            messages.push({ ...current, data })
            data = ''
            mode = 'command'
            socket.write('250 queued\r\n')
          } else {
            data += `${line}\n`
          }
          continue
        }

        if (/^(EHLO|HELO)\b/i.test(line)) socket.write('250 mock.smtp\r\n')
        else if (/^MAIL FROM:/i.test(line)) {
          current = { from: line, to: [] }
          socket.write('250 ok\r\n')
        } else if (/^RCPT TO:/i.test(line)) {
          current.to.push(line)
          socket.write('250 ok\r\n')
        } else if (/^DATA$/i.test(line)) {
          mode = 'data'
          socket.write('354 end with dot\r\n')
        } else if (/^QUIT$/i.test(line)) {
          socket.write('221 bye\r\n')
          socket.end()
        } else {
          socket.write('250 ok\r\n')
        }
      }
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        messages,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

test('sendSmtpMessage delivers mail through an SMTP server', async () => {
  const smtp = await startMockSmtpServer()
  try {
    await sendSmtpMessage(
      {
        host: '127.0.0.1',
        port: smtp.port,
        encryption: 'none',
        fromAddress: 'alerts@example.com',
        fromName: 'CT-Ops Alerts',
      },
      {
        to: ['ops@example.com', 'team@example.com'],
        subject: 'CT-Ops Test',
        text: 'Plain text body',
        html: '<p>Plain text body</p>',
      },
    )

    assert.equal(smtp.messages.length, 1)
    assert.match(smtp.messages[0].from, /alerts@example\.com/)
    assert.equal(smtp.messages[0].to.length, 2)
    assert.match(smtp.messages[0].data, /Subject: CT-Ops Test/)
    assert.match(smtp.messages[0].data, /Plain text body/)
  } finally {
    await smtp.close()
  }
})
