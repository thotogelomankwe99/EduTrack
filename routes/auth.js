import express from 'express'
import { supabase } from '../config/supabase.js';


const router = express.Router()

// Signup endpoint
router.post('/signup', async (req, res) => {
  try {
    const { email, password, full_name, school_name, role } = req.body

    // 1. Create the auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    })

    if (authError) return res.status(400).json({ error: authError.message })

    // 2. Insert user profile into public.users
    const { data, error } = await supabase
      .from('users')
      .insert([
        {
          id: authData.user.id,
          full_name,
          school_name,
          role
        }
      ])

    if (error) return res.status(400).json({ error: error.message })

    res.status(201).json({ user: data[0] })
  } catch (err) {
    console.error('Signup error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
