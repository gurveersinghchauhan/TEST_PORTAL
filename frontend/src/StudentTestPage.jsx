import { useState } from 'react';
import { useExamTimer } from "./useExamTimer";
import TestInterface from './TestInterface';

/**
 * StudentTestPage
 * ---------------
 * The actual page a student sees. All timer state comes from the server
 * via useExamTimer — this component just feeds it into TestInterface and
 * reacts to a force-submit by kicking off the real submit-to-DB flow.
 */
export default function StudentTestPage({ student, teacherId, test }) {
  const [activePartIndex, setActivePartIndex] = useState(0);
  const [answered] = useState(new Set());

  const timer = useExamTimer(
    {
      studentId: student.id,
      studentName: student.name,
      teacherId,
      testId: test.id,
      durationSeconds: test.durationMinutes * 60,
    },
    () => {
      // Server told us the teacher force-submitted — run the real submit flow here
      // (POST /api/submissions, then redirect), not just a local state flip.
      submitTest({ auto: true, reason: 'teacher_force_submit' });
    }
  );

  function submitTest(meta = {}) {
    // Wire this up to your actual submission endpoint.
    console.log('Submitting test', meta);
  }

  return (
    <TestInterface
      test={test}
      activePartIndex={activePartIndex}
      onChangePart={setActivePartIndex}
      answeredQuestionNumbers={answered}
      timer={timer} // { label, status, timeRemaining, connected }
      onSubmitTest={() => submitTest({ auto: false })}
    />
  );
}