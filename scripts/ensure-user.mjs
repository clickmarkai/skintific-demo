import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

async function main() {
  const email = process.argv[2]
  const password = process.argv[3]

  if (!email || !password) {
    console.error('Usage: node scripts/ensure-user.mjs <email> <password>')
    process.exit(1)
  }

  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment')
    process.exit(1)
  }

  const admin = createClient(url, serviceKey)

  // Find user by email via pagination
  let page = 1
  let foundUser = null
  while (page < 50 && !foundUser) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) {
      console.error('List users error:', error.message)
      process.exit(1)
    }
    foundUser = (data.users || []).find(u => (u.email || '').toLowerCase() === email.toLowerCase()) || null
    if (foundUser) break
    if (!data.users || data.users.length === 0) break
    page += 1
  }

  if (foundUser) {
    console.log('User exists, resetting password...')
    const { error: updErr } = await admin.auth.admin.updateUserById(foundUser.id, { password })
    if (updErr) {
      console.error('Failed to reset password:', updErr.message)
      process.exit(1)
    }
    console.log('Password reset for', email)
  } else {
    console.log('User not found, creating...')
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error) {
      console.error('Failed to create user:', error.message)
      process.exit(1)
    }
    console.log('Created user', data.user?.id)
  }

  console.log('Done')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})


