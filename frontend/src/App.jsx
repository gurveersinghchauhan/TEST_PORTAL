import { useState } from 'react';
import StudentTestPage from './StudentTestPage';
import TeacherDashboard from './TeacherDashboard';

// Nakli test data jisme humne id aur durationMinutes add kar diya hai
const mockTest = {
  id: 'test_001',
  title: 'Academic Reading Practice Test 3',
  module: 'reading',
  durationMinutes: 60, // 60 minute ka test hai
  parts: [
    {
      partNumber: 1,
      instructions: 'Read the text and answer questions 1–13.',
      passageText:
        'Marie Curie is probably the most famous woman scientist who has ever lived...\n\nBorn in Warsaw in 1867, Maria Sklodowska, as she was named, was the daughter of a teacher...',
      questionGroups: [
        {
          groupInstructions: "Choose TRUE, FALSE or NOT GIVEN.",
          questionType: 'true-false-not-given',
          startNumber: 1,
          endNumber: 3,
          questions: [
            {
              questionNumber: 1,
              type: 'true-false-not-given',
              prompt: "Marie Curie's husband was a joint winner of both Marie's Nobel Prizes.",
              options: [],
              correctAnswer: 'FALSE',
            },
            {
              questionNumber: 2,
              type: 'true-false-not-given',
              prompt: 'Marie became interested in science when she was a child.',
              options: [],
              correctAnswer: 'NOT GIVEN',
            },
            {
              questionNumber: 3,
              type: 'true-false-not-given',
              prompt: 'Marie financed her own university education in Paris.',
              options: [],
              correctAnswer: 'FALSE',
            },
          ],
        },
      ],
    },
    {
      partNumber: 2,
      instructions: 'The text has four sections. Drag the correct heading onto each section.',
      paragraphs: [
        {
          id: 'p1',
          dropSlotNumber: 14,
          text: 'Some years ago, when several theoretical physicists began publishing papers on traffic flow...',
        },
      ],
      headingBank: [
        { id: 'h1', text: 'How a maths experiment actually reduced traffic congestion' },
        { id: 'h2', text: 'How a concept from one field of study was applied in another' },
      ],
      questionGroups: [],
    },
  ],
};

// Nakli (dummy) user data taaki page crash na ho
const dummyStudent = { id: 'student_123', name: 'Gurveer Singh' };
const dummyTeacherId = 'teacher_999';

export default function App() {
  const [view, setView] = useState('student');

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      {/* Top Bar - Views switch karne ke liye */}
      <div className="bg-neutral-800 p-2 flex justify-center gap-4 shrink-0">
        <button 
          className={`px-4 py-1 rounded font-bold ${view === 'student' ? 'bg-rose-600 text-white' : 'bg-neutral-600 text-neutral-300'}`}
          onClick={() => setView('student')}
        >
          View as Student
        </button>
        <button 
          className={`px-4 py-1 rounded font-bold ${view === 'teacher' ? 'bg-rose-600 text-white' : 'bg-neutral-600 text-neutral-300'}`}
          onClick={() => setView('teacher')}
        >
          View as Teacher
        </button>
      </div>

      {/* Main Screen */}
      <div className="flex-1 overflow-hidden relative">
        {view === 'student' ? (
          <StudentTestPage 
            student={dummyStudent} 
            teacherId={dummyTeacherId} 
            test={mockTest} 
          />
        ) : (
          <TeacherDashboard teacherId={dummyTeacherId} />
        )}
      </div>
    </div>
  );
}