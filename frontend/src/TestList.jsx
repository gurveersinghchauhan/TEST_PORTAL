import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function TestList() {
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Backend se saare tests fetch karne ka logic
  useEffect(() => {
    fetch('http://localhost:5000/api/tests') // Apne backend ka URL yahan check kar lena
      .then((res) => res.json())
      .then((data) => {
        setTests(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Error fetching tests:", err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen bg-slate-50">
        <p className="text-lg font-medium text-slate-600 animate-pulse">Loading amazing tests...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-6 sm:px-10">
      <div className="max-w-7xl mx-auto">
        
        {/* Header Section */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Academic Reading Practice Tests</h1>
          <p className="text-slate-500 mt-1">Select a test below to start your practice session.</p>
        </div>

        {/* Tests Grid Layout */}
        {tests.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 shadow-sm">
            <p className="text-slate-500 text-lg">No tests found in the database yet.</p>
            <p className="text-slate-400 text-sm mt-1">Insert a test via MongoDB or Test Builder to see it here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {tests.map((test) => (
              <div 
                key={test._id} 
                className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col justify-between group"
              >
                {/* Card Title & Info */}
                <div>
                  <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center font-bold mb-4 group-hover:scale-110 transition-transform">
                    📖
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 leading-snug group-hover:text-teal-600 transition-colors">
                    {test.title}
                  </h3>
                  <div className="flex items-center gap-4 mt-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    <span>⏳ {test.durationMinutes || 20} mins</span>
                    <span>•</span>
                    <span>❓ {test.totalQuestions || 13} Questions</span>
                  </div>
                </div>

                {/* Take Test Button (Sirf yehi chahiye tha) */}
                <div className="mt-8 pt-4 border-t border-slate-100">
                  <button
                    onClick={() => navigate(`/test/${test._id}`)}
                    className="w-full py-3 px-4 bg-teal-600 hover:bg-teal-700 active:scale-[0.98] text-white font-semibold rounded-xl shadow-lg shadow-teal-600/20 transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    Take Test
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>

              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}