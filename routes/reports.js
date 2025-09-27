// reports.js - UPDATED VERSION
import express from 'express';
import { supabase, verifySupabaseToken, handleSupabaseError } from '../config/supabase.js';
import moment from 'moment';

const router = express.Router();

// -----------------------------
// Middleware: Authenticate teacher
// -----------------------------
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

// -----------------------------
// GET /stats → Attendance statistics
// -----------------------------
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const { period = 'week' } = req.query;
    const startDate = moment().subtract(1, period).format('YYYY-MM-DD');
    const today = moment().format('YYYY-MM-DD');

    // Total active students
    const { data: students, error: studentsError } = await supabase
      .from('students')
      .select('id')
      .eq('teacher_id', req.user.id)
      .eq('is_active', true);

    if (studentsError) throw studentsError;
    const totalStudents = students.length;

    // Today's attendance (join sessions)
    const { data: todayAttendance, error: todayError } = await supabase
      .from('attendance_records')
      .select('status, attendance_sessions!inner(session_date, teacher_id)')
      .eq('attendance_sessions.teacher_id', req.user.id)
      .eq('attendance_sessions.session_date', today);

    if (todayError) throw todayError;

    const presentToday = todayAttendance.filter(a => a.status === 'present').length;
    const absentToday = totalStudents - presentToday;

    // Period trends
    const { data: periodAttendance, error: periodError } = await supabase
      .from('attendance_records')
      .select('status, attendance_sessions!inner(session_date, teacher_id)')
      .eq('attendance_sessions.teacher_id', req.user.id)
      .gte('attendance_sessions.session_date', startDate);

    if (periodError) throw periodError;

    const trends = {};
    periodAttendance.forEach(record => {
      const date = record.attendance_sessions.session_date;
      if (!trends[date]) trends[date] = { present: 0, total: 0 };
      trends[date].total++;
      if (record.status === 'present') trends[date].present++;
    });

    res.json({
      stats: {
        totalStudents,
        presentToday,
        absentToday,
        attendanceRate: totalStudents > 0 ? ((presentToday / totalStudents) * 100).toFixed(1) : 0
      },
      trends
    });

  } catch (error) {
    handleSupabaseError(error, res);
  }
});

// -----------------------------
// GET /report → Attendance report (ENHANCED VERSION)
// -----------------------------
router.get('/report', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, studentId, class_name, reportType = 'summary' } = req.query;

    let query = supabase
      .from('attendance_records')
      .select(`
        *,
        students (name, class_name),
        attendance_sessions!inner(session_date, class_name, teacher_id)
      `)
      .eq('attendance_sessions.teacher_id', req.user.id);

    if (startDate) query = query.gte('attendance_sessions.session_date', startDate);
    if (endDate) query = query.lte('attendance_sessions.session_date', endDate);
    if (studentId && studentId !== 'all') query = query.eq('student_id', studentId);
    if (class_name && class_name !== 'all') query = query.eq('attendance_sessions.class_name', class_name);

    const { data: attendance, error } = await query.order('attendance_sessions.session_date', { ascending: false });
    if (error) throw error;

    // Process data for different report types
    let reportData = {};
    
    if (reportType === 'summary') {
      // Summary report by date
      const summaryByDate = {};
      attendance.forEach(record => {
        const date = record.attendance_sessions.session_date;
        if (!summaryByDate[date]) {
          summaryByDate[date] = {
            date: date,
            class_name: record.attendance_sessions.class_name,
            totalStudents: 0,
            present: 0,
            absent: 0,
            attendanceRate: 0
          };
        }
        
        summaryByDate[date].totalStudents++;
        if (record.status === 'present') {
          summaryByDate[date].present++;
        } else {
          summaryByDate[date].absent++;
        }
        
        summaryByDate[date].attendanceRate = summaryByDate[date].totalStudents > 0 
          ? ((summaryByDate[date].present / summaryByDate[date].totalStudents) * 100).toFixed(1)
          : 0;
      });
      
      reportData.summary = Object.values(summaryByDate);
    } else if (reportType === 'student') {
      // Student-wise report
      const studentReport = {};
      attendance.forEach(record => {
        const studentId = record.student_id;
        if (!studentReport[studentId]) {
          studentReport[studentId] = {
            student_id: studentId,
            student_name: record.students?.name || 'Unknown',
            class_name: record.students?.class_name || record.attendance_sessions.class_name,
            totalDays: 0,
            presentDays: 0,
            absentDays: 0,
            attendanceRate: 0
          };
        }
        
        studentReport[studentId].totalDays++;
        if (record.status === 'present') {
          studentReport[studentId].presentDays++;
        } else {
          studentReport[studentId].absentDays++;
        }
        
        studentReport[studentId].attendanceRate = studentReport[studentId].totalDays > 0
          ? ((studentReport[studentId].presentDays / studentReport[studentId].totalDays) * 100).toFixed(1)
          : 0;
      });
      
      reportData.studentReport = Object.values(studentReport);
    }

    res.json({
      report: {
        period: { startDate, endDate },
        filters: { studentId, class_name, reportType },
        totalRecords: attendance.length,
        ...reportData,
        rawData: attendance
      }
    });

  } catch (error) {
    handleSupabaseError(error, res);
  }
});

export default router;