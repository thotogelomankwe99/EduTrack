import express from 'express';
import QRCode from 'qr-image';
import { supabase, verifySupabaseToken, handleSupabaseError } from '../config/supabase.js';
import moment from 'moment';

const router = express.Router();

// Middleware to authenticate teacher token
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

// Generate daily QR code session
router.post('/sessions', authenticateToken, async (req, res) => {
  try {
    const { class_name } = req.body;
    const today = moment().format('YYYY-MM-DD');

    if (!class_name) return res.status(400).json({ error: 'Class name is required' });

    // Check if session already exists for today
    const { data: existingSession } = await supabase
      .from('attendance_sessions')
      .select('*')
      .eq('teacher_id', req.user.id)
      .eq('session_date', today)
      .eq('is_active', true)
      .single();

    if (existingSession) {
      return res.json({
        message: 'Session already exists for today',
        session: existingSession,
        qr_data: existingSession.qr_code
      });
    }

    // Generate unique QR data
    const qrData = JSON.stringify({
      session_id: `SESSION_${Date.now()}`,
      teacher_id: req.user.id,
      class_name: class_name,
      session_date: today,
      timestamp: Date.now(),
      type: 'attendance'
    });

    // Create attendance session
    const { data: session, error } = await supabase
      .from('attendance_sessions')
      .insert([
        {
          teacher_id: req.user.id,
          class_name,
          session_date: today,
          qr_code: qrData,
          is_active: true,
          expires_at: moment().endOf('day').toISOString()
        }
      ])
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: 'Attendance session created successfully',
      session,
      qr_data: qrData
    });

  } catch (error) {
    handleSupabaseError(error, res);
  }
});

// Get QR code as PNG image
router.get('/sessions/:sessionId/qr-code', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const { data: session, error } = await supabase
      .from('attendance_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error || !session) return res.status(404).json({ error: 'Session not found' });

    const qr_png = QRCode.image(session.qr_code, { type: 'png', size: 10, margin: 2 });
    res.setHeader('Content-type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    qr_png.pipe(res);

  } catch (error) {
    handleSupabaseError(error, res);
  }
});

// Student scan endpoint - returns student form URL
router.post('/scan', async (req, res) => {
  try {
    const { qr_data } = req.body;
    if (!qr_data) return res.status(400).json({ error: 'QR data required' });

    const parsedData = JSON.parse(qr_data);
    const today = moment().format('YYYY-MM-DD');

    if (parsedData.session_date !== today) return res.status(400).json({ error: 'QR code expired' });

    const { data: session } = await supabase
      .from('attendance_sessions')
      .select('*')
      .eq('teacher_id', parsedData.teacher_id)
      .eq('session_date', today)
      .eq('is_active', true)
      .single();

    if (!session) return res.status(404).json({ error: 'Attendance session not found' });

    const studentFormUrl = `${req.protocol}://${req.get('host')}/student-attendance.html?session=${session.id}`;

    res.json({
      success: true,
      message: 'QR code validated successfully',
      redirect_url: studentFormUrl,
      session: {
        class_name: session.class_name,
        session_date: session.session_date
      }
    });

  } catch (error) {
    handleSupabaseError(error, res);
  }
});

// Get students for a class (for student form)
router.get('/sessions/:sessionId/students', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const { data: session, error: sessionError } = await supabase
      .from('attendance_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) return res.status(404).json({ error: 'Session not found' });

    const { data: students, error: studentsError } = await supabase
      .from('students')
      .select('*')
      .eq('teacher_id', session.teacher_id)
      .eq('is_active', true)
      .order('full_name');

    if (studentsError) throw studentsError;

    res.json({
      session: {
        class_name: session.class_name,
        session_date: session.session_date
      },
      students: students || []
    });

  } catch (error) {
    handleSupabaseError(error, res);
  }
});

// Submit student attendance
router.post('/submit', async (req, res) => {
  try {
    const { session_id, student_id, full_name, student_number, status } = req.body;
    if (!session_id || !full_name) return res.status(400).json({ error: 'Session ID and student name are required' });

    const { data: session, error: sessionError } = await supabase
      .from('attendance_sessions')
      .select('*')
      .eq('id', session_id)
      .eq('is_active', true)
      .single();

    if (sessionError || !session) return res.status(404).json({ error: 'Attendance session not found or expired' });

    let studentId = student_id;

    if (!studentId) {
      const { data: existingStudent } = await supabase
        .from('students')
        .select('id')
        .eq('full_name', full_name)
        .eq('teacher_id', session.teacher_id)
        .eq('is_active', true)
        .single();

      if (!existingStudent) {
        const { data: newStudent, error: studentError } = await supabase
          .from('students')
          .insert([
            {
              full_name: full_name,
              student_number: student_number || null,
              class_name: session.class_name,
              school_name: 'Unknown',
              teacher_id: session.teacher_id,
              is_active: true
            }
          ])
          .select()
          .single();

        if (studentError) throw studentError;
        studentId = newStudent.id;
      } else {
        studentId = existingStudent.id;
      }
    }

    const { data: existingRecord } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('session_id', session_id)
      .eq('student_id', studentId)
      .single();

    if (existingRecord) return res.status(400).json({ error: 'Attendance already recorded for this student' });

    const { data: attendance, error } = await supabase
      .from('attendance_records')
      .insert([
        {
          session_id: session_id,
          student_id: studentId,
          status: status || 'present',
          method: 'qr_scan',
          submitted_at: new Date().toISOString()
        }
      ])
      .select(`*, students (full_name, student_number)`)
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Attendance recorded successfully',
      attendance
    });

  } catch (error) {
    handleSupabaseError(error, res);
  }
});

// Manual attendance marking
router.post('/manual', authenticateToken, async (req, res) => {
  try {
    const { student_id, status, reason, notes } = req.body;
    const today = moment().format('YYYY-MM-DD');

    if (!student_id || !status) return res.status(400).json({ error: 'Student ID and status required' });

    let { data: session } = await supabase
      .from('attendance_sessions')
      .select('*')
      .eq('teacher_id', req.user.id)
      .eq('session_date', today)
      .eq('is_active', true)
      .single();

    if (!session) {
      const { data: newSession } = await supabase
        .from('attendance_sessions')
        .insert([
          {
            teacher_id: req.user.id,
            class_name: 'Manual Entry',
            session_date: today,
            qr_code: `MANUAL_${Date.now()}`,
            is_active: true
          }
        ])
        .select()
        .single();
      session = newSession;
    }

    const { data: student } = await supabase
      .from('students')
      .select('id')
      .eq('id', student_id)
      .eq('teacher_id', req.user.id)
      .eq('is_active', true)
      .single();

    if (!student) return res.status(404).json({ error: 'Student not found' });

    const { data: existingRecord } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('session_id', session.id)
      .eq('student_id', student_id)
      .single();

    let attendance;
    if (existingRecord) {
      const { data: updatedAttendance, error: updateError } = await supabase
        .from('attendance_records')
        .update({
          status,
          reason,
          notes,
          submitted_at: new Date().toISOString()
        })
        .eq('id', existingRecord.id)
        .select(`*, students (full_name, student_number)`)
        .single();

      if (updateError) throw updateError;
      attendance = updatedAttendance;
    } else {
      const { data: newAttendance, error: createError } = await supabase
        .from('attendance_records')
        .insert([
          {
            session_id: session.id,
            student_id: student_id,
            status: status,
            method: 'manual',
            reason: reason || null,
            notes: notes || null,
            submitted_at: new Date().toISOString()
          }
        ])
        .select(`*, students (full_name, student_number)`)
        .single();

      if (createError) throw createError;
      attendance = newAttendance;
    }

    res.json({
      message: 'Attendance recorded successfully',
      attendance
    });

  } catch (error) {
    handleSupabaseError(error, res);
  }
});

// Get today's attendance
router.get('/today', authenticateToken, async (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');

    const { data: attendance, error } = await supabase
      .from('attendance_records')
      .select(`*, students (full_name, student_number), attendance_sessions (class_name, session_date)`)
      .eq('attendance_sessions.teacher_id', req.user.id)
      .eq('attendance_sessions.session_date', today)
      .order('submitted_at', { ascending: false });

    if (error) throw error;

    res.json({ attendance: attendance || [] });

  } catch (error) {
    handleSupabaseError(error, res);
  }
});

export default router;
