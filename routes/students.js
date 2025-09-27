import express from 'express';
import { supabase, verifySupabaseToken, handleSupabaseError } from '../config/supabase.js';

const router = express.Router();

const authenticateToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const user = await verifySupabaseToken(token);
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Get all students for a teacher
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { data: students, error } = await supabase
      .from('students')
      .select('id, full_name, student_number, class_name, school_name, is_active')
      .eq('teacher_id', req.user.id)
      .eq('is_active', true)
      .order('full_name');

    if (error) throw error;

    res.json({ students: students || [] });

  } catch (error) {
    handleSupabaseError(error, res);
  }
});

// Add new student
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { full_name, student_number, class_name } = req.body;

    if (!full_name) {
      return res.status(400).json({ error: 'Student full name is required' });
    }

    // Get teacher info
    const { data: teacher } = await supabase
      .from('users')
      .select('school_name')
      .eq('id', req.user.id)
      .single();

    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    const studentData = {
      full_name,
      student_number: student_number || null,
      class_name: class_name || null,
      school_name: teacher.school_name,
      teacher_id: req.user.id,
      is_active: true
    };

    const { data: student, error } = await supabase
      .from('students')
      .insert([studentData])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ message: 'Student added successfully', student });

  } catch (error) {
    handleSupabaseError(error, res);
  }
});

// Update student
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, student_number, class_name, is_active } = req.body;

    const { data: student, error } = await supabase
      .from('students')
      .update({ full_name, student_number, class_name, is_active })
      .eq('id', id)
      .eq('teacher_id', req.user.id)
      .select()
      .single();

    if (error) throw error;
    if (!student) return res.status(404).json({ error: 'Student not found' });

    res.json({ message: 'Student updated successfully', student });

  } catch (error) {
    handleSupabaseError(error, res);
  }
});

// Delete student (soft delete)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: student, error } = await supabase
      .from('students')
      .update({ is_active: false })
      .eq('id', id)
      .eq('teacher_id', req.user.id)
      .select()
      .single();

    if (error) throw error;
    if (!student) return res.status(404).json({ error: 'Student not found' });

    res.json({ message: 'Student deleted successfully' });

  } catch (error) {
    handleSupabaseError(error, res);
  }
});

export default router;
