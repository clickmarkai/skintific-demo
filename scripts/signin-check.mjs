import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

async function main() {
  const email = process.argv[2]
  const password = process.argv[3]
  if (!email || !password) {
    console.error('Usage: node scripts/signin-check.mjs <email> <password>')
    process.exit(1)
  }
  const url = process.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anon) {
    console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
    process.exit(1)
  }
  const supabase = createClient(url, anon)
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    console.error('Sign-in failed:', error.message)
    process.exit(2)
  }
  console.log('Sign-in OK. user:', data.user?.id, 'session:', Boolean(data.session))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})


