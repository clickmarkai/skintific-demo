import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

async function main() {
  const email = process.argv[2]
  const password = process.argv[3]

  if (!email || !password) {
    console.error('Usage: node scripts/create-user.mjs <email> <password>')
    process.exit(1)
  }

  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment')
    process.exit(1)
  }

  const supabase = createClient(url, serviceKey)

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error) {
    console.error('Failed to create user:', error.message)
    process.exit(1)
  }

  const userId = data.user?.id
  console.log('Created auth user:', userId)

  // Best-effort: ensure a row exists in users table for app code
  try {
    if (userId) {
      const { error: upsertErr } = await supabase
        .from('users')
        .upsert({
          id: userId,
          email,
          source: 'script',
          consent_email: true,
          created_at: new Date().toISOString(),
        })
      if (upsertErr) console.warn('Warning: could not upsert into users table:', upsertErr.message)
      else console.log('Upserted into users table')
    }
  } catch (e) {
    console.warn('Warning: users table not available or insert failed')
  }

  console.log('Done')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})


