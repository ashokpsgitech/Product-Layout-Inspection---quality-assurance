import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  collection,
  onSnapshot,
  query,
  where,
  updateDoc,
  addDoc,
  getDoc,
  deleteDoc
} from 'firebase/firestore';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// Tailwind CSS CDN - this makes the styling work in your local HTML file
const TailwindScript = () => (
  <script src="https://cdn.tailwindcss.com"></script>
);

//
// IMPORTANT: Replace these with your own Firebase project configuration.
// You can find this in your Firebase Console under Project Settings.
//
const STATUS = {
  TEAM_LEADER_REVIEWED: 'Reviewed by Team Leader Audit',
  HOF_REVIEWED: 'Reviewed by H.O.F. Audit',
  APPROVED: 'Approved'
};

const firebaseConfig = {
  apiKey: ,
  authDomain: ,
  projectId:   ,
  storageBucket:   ,
  messagingSenderId:   ,
  appId: ,
  measurementId: 
};

// Use a placeholder appId for Firestore collection path.
// This is not the same as the app ID in firebaseConfig.
const appId = "local-quality-control-app";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Helper function to convert a Firestore timestamp to a readable date string
const formatTimestamp = (timestamp) => {
  if (!timestamp) return 'N/A';
  const date = timestamp.toDate();
  return date.toLocaleString();
};

const roleCodes = {
  'Auditor': 'AUDITOR123',
  'Team Leader Audit': 'TLA456',
  'H.O.F. Audit': 'HOF789',
  'Quality Head': 'QH0101'
};

// Helper function to check if an observation is within spec
const isObservationOK = (observation, specification) => {
  if (observation === '') {
    return true;
  }
  const specMatch = specification.match(/([0-9.]+)\s*±\s*([0-9.]+)/);
  let specValue;
  let tolerance;

  if (specMatch) {
    specValue = parseFloat(specMatch[1]);
    tolerance = parseFloat(specMatch[2]);
  } else {
    const parts = specification.split(' ');
    specValue = parseFloat(parts[0]);
    tolerance = parts.length > 1 ? parseFloat(parts[1]) : 0;
  }

  const obsValue = parseFloat(observation);

  if (isNaN(specValue) || isNaN(obsValue) || isNaN(tolerance)) {
    return false;
  }
  const diff = Math.abs(obsValue - specValue);
  return diff <= tolerance;
};

// Helper function to format role name for Firestore keys.
// This is defined outside the components so it can be used by multiple components.
const formatRoleKey = (roleName) => {
  // Converts role names like "H.O.F. Audit" to "hofaudit"
  return roleName.toLowerCase().replace(/\s/g, '').replace(/\./g, '');
};

// Main App Component
const App = () => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showNotification, setShowNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [showSignup, setShowSignup] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [parts, setParts] = useState([]);
  const [users, setUsers] = useState([]);

  // Handle a simple notification modal
  const showCustomNotification = (message) => {
    setNotificationMessage(message);
    setShowNotification(true);
    setTimeout(() => {
      setShowNotification(false);
      setNotificationMessage('');
    }, 3000);
  };

  // Set up auth state listener for standard Firebase Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      setUser(authUser);
      if (authUser) {
        // Fetch user role from Firestore
        const userDocRef = doc(db, `/artifacts/${appId}/public/data/users`, authUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          setRole(userDocSnap.data().role);
        } else {
          setRole(null); // Role not found, handle gracefully
        }
      } else {
        setRole(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Fetch parts, reports and users from Firestore
  useEffect(() => {
    if (!user) {
      setReports([]); // Clear reports if user logs out
      setParts([]);
      setUsers([]);
      return;
    }

    const reportsCollectionRef = collection(db, `/artifacts/${appId}/public/data/inspectionReports`);
    const partsCollectionRef = collection(db, `/artifacts/${appId}/public/data/parts`);
    const usersCollectionRef = collection(db, `/artifacts/${appId}/public/data/users`);

    const unsubscribeReports = onSnapshot(reportsCollectionRef, (snapshot) => {
      const fetchedReports = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setReports(fetchedReports);
    }, (e) => {
      console.error("Firestore fetch error:", e);
      setError("Failed to fetch reports.");
    });

    const unsubscribeParts = onSnapshot(partsCollectionRef, (snapshot) => {
      const fetchedParts = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setParts(fetchedParts);
    });

    const unsubscribeUsers = onSnapshot(usersCollectionRef, (snapshot) => {
      const fetchedUsers = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setUsers(fetchedUsers);
    });

    return () => {
      unsubscribeReports();
      unsubscribeParts();
      unsubscribeUsers();
    };
  }, [user]);

  const handleLogout = async () => {
    setRole(null);
    setSelectedReport(null);
    try {
      await signOut(auth);
    } catch (e) {
      console.error("Error signing out:", e);
    }
  };
  
  // Handle report approval logic
  const handleApproval = async (reportId, newStatus) => {
    if (!user || !user.uid) {
      showCustomNotification("Error: You must be signed in to perform this action.");
      return;
    }
    try {
      const reportDocRef = doc(db, `/artifacts/${appId}/public/data/inspectionReports`, reportId);
      await updateDoc(reportDocRef, {
        status: newStatus,
        lastUpdatedBy: role,
        [`${formatRoleKey(role)}Signature`]: user.uid
      });
      showCustomNotification(`Report ${reportId} ${newStatus === 'Approved' ? 'approved' : 'reviewed'} by ${role}.`);
      setSelectedReport(null);
    } catch (e) {
      console.error("Error updating document:", e);
      setError("Failed to update report status.");
    }
  };

  // Handle report rejection logic
  const handleRejection = async (reportId) => {
    if (!user || !user.uid) {
      showCustomNotification("Error: You must be signed in to perform this action.");
      return;
    }
    try {
      const reportDocRef = doc(db, `/artifacts/${appId}/public/data/inspectionReports`, reportId);
      await updateDoc(reportDocRef, {
        status: 'Re-scheduling',
        lastUpdatedBy: role,
        remarks: `Rejected by ${role} for re-scheduling.`,
        [`${formatRoleKey(role)}Signature`]: user.uid
      });
      showCustomNotification(`Report ${reportId} rejected by ${role}. Re-scheduling needed.`);
      setSelectedReport(null);
    } catch (e) {
      console.error("Error updating document:", e);
      setError("Failed to update report status.");
    }
  };

  // Render different dashboards based on the selected role
  const renderDashboard = () => {
    if (loading || !user || !role) {
      return (
        <div className="text-center p-8 bg-white rounded-lg shadow-lg border-b-4 border-gray-400">
          <p className="text-xl font-semibold">Loading dashboard...</p>
        </div>
      );
    }

    if (role === 'Auditor') {
      return <AuditorDashboard user={user} db={db} appId={appId} showNotification={showCustomNotification} parts={parts} reports={reports} users={users} />;
    }

    return (
      <HigherAuthorityDashboard
        role={role}
        reports={reports}
        onSelectReport={setSelectedReport}
        selectedReport={selectedReport}
        onApprove={handleApproval}
        onReject={handleRejection}
        showNotification={showCustomNotification}
        userId={user?.uid}
        parts={parts}
        users={users}
        db={db}
        appId={appId}
      />
    );
  };

  const handleLogin = async (email, password) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      showCustomNotification("Logged in successfully!");
    } catch (e) {
      console.error("Login error:", e);
      showCustomNotification("Login failed. Please check your email and password.");
    }
  };

  const handleSignup = async (email, password, role, authCode) => {
    if (roleCodes[role] !== authCode) {
      showCustomNotification("Invalid authentication code for the selected role.");
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const userDocRef = doc(db, `/artifacts/${appId}/public/data/users`, userCredential.user.uid);
      await setDoc(userDocRef, {
        email: email,
        role: role,
        createdAt: new Date(),
      });
      showCustomNotification("Signed up and logged in successfully!");
    } catch (e) {
      let errorMessage = "Signup failed. Please try again.";
      if (e.code === 'auth/email-already-in-use') {
        errorMessage = "Signup failed: This email is already in use.";
      } else if (e.code === 'auth/weak-password') {
        errorMessage = "Signup failed: The password is too weak. It must be at least 6 characters long.";
      } else if (e.code === 'auth/invalid-email') {
        errorMessage = "Signup failed: The email address is not valid.";
      }
      console.error("Signup error:", e);
      showCustomNotification(errorMessage);
    }
  };

  const handleRequestPasswordReset = async (email) => {
    try {
      await sendPasswordResetEmail(auth, email);
      showCustomNotification("Password reset email sent. Please check your inbox.");
      return true;
    } catch (e) {
      console.error("Password reset error:", e);
      let errorMessage = "Error sending password reset email.";
      if (e.code === 'auth/user-not-found') {
        errorMessage = "Error: User not found with this email address.";
      } else if (e.code === 'auth/invalid-email') {
        errorMessage = "Error: The email address is not valid.";
      }
      showCustomNotification(errorMessage);
      return false;
    }
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500 mb-4"></div>
          <p className="text-gray-600">Loading application...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="flex justify-center items-center h-screen text-red-500">{error}</div>;
  }

  return (
    <>
      <div className="min-h-screen bg-gray-100 font-sans text-gray-800 antialiased">
        <div className="container mx-auto p-4 sm:p-6 lg:p-8">
          <header className="bg-white p-4 rounded-xl shadow-lg mb-6 flex flex-col sm:flex-row justify-between items-center border-b-4 border-blue-500">
            <h1 className="text-3xl font-bold text-gray-800 mb-4 sm:mb-0">Quality Control App</h1>
            {user ? (
              <div className="flex items-center space-x-4">
                <span className="text-sm font-medium text-gray-600 hidden sm:block">Signed in as: <span className="font-semibold">{role || 'Not Selected'}</span></span>
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition duration-300 transform hover:scale-105"
                >
                  Logout
                </button>
              </div>
            ) : (
              <div className="w-full max-w-md mx-auto">
                {showSignup ? (
                  <SignupForm onSignup={handleSignup} onSwitchToLogin={() => { setShowSignup(false); setShowForgotPassword(false); }} />
                ) : showForgotPassword ? (
                  <ForgotPasswordForm
                    onRequestPasswordReset={handleRequestPasswordReset}
                    onSwitchToLogin={() => { setShowSignup(false); setShowForgotPassword(false); }}
                    showNotification={showCustomNotification}
                  />
                ) : (
                  <LoginForm onLogin={handleLogin} onSwitchToSignup={() => setShowSignup(true)} onSwitchToForgotPassword={() => setShowForgotPassword(true)} />
                )}
              </div>
            )}
          </header>
          <main className="min-h-[60vh] flex items-center justify-center">
            {user ? renderDashboard() : <div className="text-center p-8 bg-white rounded-xl shadow-lg">Please log in to continue.</div>}
          </main>
          {showNotification && (
            <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 p-4 rounded-lg bg-green-500 text-white shadow-lg z-50 transition-opacity duration-300 ease-in-out">
              {notificationMessage}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

const LoginForm = ({ onLogin, onSwitchToSignup, onSwitchToForgotPassword }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onLogin(email, password);
  };

  return (
    <div className="bg-white p-8 rounded-xl shadow-lg border-b-4 border-blue-500">
      <h2 className="text-3xl font-bold mb-6 text-center text-gray-800">Login</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
            required
          />
        </div>
        <div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
            required
          />
        </div>
        <button
          type="submit"
          className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition duration-300 transform hover:scale-105"
        >
          Login
        </button>
      </form>
      <div className="mt-6 text-center text-sm space-y-2">
        <button onClick={onSwitchToForgotPassword} className="text-blue-600 font-semibold hover:underline block">
          Forgot Password?
        </button>
        <p className="text-gray-500">
          Don't have an account?{' '}
          <button onClick={onSwitchToSignup} className="text-blue-600 font-semibold hover:underline">
            Sign Up
          </button>
        </p>
      </div>
    </div>
  );
};

const SignupForm = ({ onSignup, onSwitchToLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [selectedRoleForSignup, setSelectedRoleForSignup] = useState('Auditor');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSignup(email, password, selectedRoleForSignup, authCode);
  };

  return (
    <div className="bg-white p-8 rounded-xl shadow-lg border-b-4 border-green-500">
      <h2 className="text-3xl font-bold mb-6 text-center text-gray-800">Sign Up</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 transition duration-200"
            required
          />
        </div>
        <div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 transition duration-200"
            required
          />
        </div>
        <div>
          <select
            value={selectedRoleForSignup}
            onChange={(e) => setSelectedRoleForSignup(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 transition duration-200"
          >
            <option value="Auditor">Auditor</option>
            <option value="Team Leader Audit">Team Leader Audit</option>
            <option value="H.O.F. Audit">H.O.F. Audit</option>
            <option value="Quality Head">Quality Head</option>
          </select>
        </div>
        <div>
          <input
            type="password"
            value={authCode}
            onChange={(e) => setAuthCode(e.target.value)}
            placeholder="Authentication Code"
            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 transition duration-200"
            required
          />
        </div>
        <button
          type="submit"
          className="w-full py-3 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 transition duration-300 transform hover:scale-105"
        >
          Sign Up
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-gray-500">
        Already have an account?{' '}
        <button onClick={onSwitchToLogin} className="text-blue-600 font-semibold hover:underline">
          Log In
        </button>
      </p>
    </div>
  );
};

const ForgotPasswordForm = ({ onRequestPasswordReset, onSwitchToLogin, showNotification }) => {
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  const handleRequestClick = async (e) => {
    e.preventDefault();
    const success = await onRequestPasswordReset(email);
    if (success) {
      setEmailSent(true);
      showNotification("Password reset email sent. Please check your inbox.");
    }
  };

  return (
    <div className="bg-white p-8 rounded-xl shadow-lg border-b-4 border-indigo-500">
      <h2 className="text-3xl font-bold mb-6 text-center text-gray-800">Forgot Password</h2>
      <p className="text-sm text-gray-600 mb-6 text-center">
        Enter your email to receive a password reset link.
      </p>
      <form onSubmit={handleRequestClick} className="space-y-4">
        <div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 transition duration-200"
            required
            disabled={emailSent}
          />
        </div>
        {!emailSent && (
          <button
            type="submit"
            className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition duration-300 transform hover:scale-105"
          >
            Send Reset Link
          </button>
        )}
      </form>
      <p className="mt-6 text-center text-sm">
        <button onClick={onSwitchToLogin} className="text-blue-600 font-semibold hover:underline">
          Back to Login
        </button>
      </p>
    </div>
  );
};

const AuditorDashboard = ({ user, db, appId, showNotification, parts, reports, users }) => {
  const [formData, setFormData] = useState({
    partNo: '',
    partName: '',
    customer: '',
    remarks: '',
    characteristics: [],
  });
  const [selectedPart, setSelectedPart] = useState(null);
  const [activeTab, setActiveTab] = useState('new-report');
  const [selectedPartForLogs, setSelectedPartForLogs] = useState('');

  const getInitialCharacteristics = (part) => {
    const characteristics = part.characteristics || [];
    const expandedCharacteristics = [];
    characteristics.forEach(char => {
      const specMatch = char.specification.match(/^(\d+)\s*x\s*(.*)/);
      if (specMatch) {
        const count = parseInt(specMatch[1], 10);
        const cleanedSpec = specMatch[2].trim();
        for (let i = 0; i < count; i++) {
          expandedCharacteristics.push({
            name: `${char.name} (${i + 1})`,
            specification: cleanedSpec,
            checkMethod: char.checkMethod,
            observations: ['', '', '', '', '', ''],
          });
        }
      } else {
        expandedCharacteristics.push(char);
      }
    });
    return expandedCharacteristics;
  };

  useEffect(() => {
    if (selectedPart) {
      setFormData({
        partNo: selectedPart.partNo,
        partName: selectedPart.partName,
        customer: selectedPart.customer,
        remarks: '',
        characteristics: getInitialCharacteristics(selectedPart),
      });
    }
  }, [selectedPart]);

  const handleObservationChange = (charIndex, obsIndex, value) => {
    const newCharacteristics = [...formData.characteristics];
    newCharacteristics[charIndex].observations[obsIndex] = value;
    setFormData({ ...formData, characteristics: newCharacteristics });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!user || !user.uid) {
      showNotification("Error: You must be signed in to perform this action.");
      return;
    }

    const reportId = `${formData.partNo}-${Date.now()}`;
    const reportData = {
      ...formData,
      id: reportId,
      status: 'Submitted',
      submittedBy: user.uid,
      submissionDate: new Date(),
    };

    try {
      const reportsCollectionRef = collection(db, `/artifacts/${appId}/public/data/inspectionReports`);
      await setDoc(doc(reportsCollectionRef, reportId), reportData);
      showNotification('Report submitted successfully!');
      setFormData({
        partNo: '',
        partName: '',
        customer: '',
        remarks: '',
        characteristics: [],
      });
      setSelectedPart(null);
    } catch (e) {
      console.error("Error adding document:", e);
    }
  };

  const filteredReportsByPart = selectedPartForLogs
    ? reports.filter(report => report.partNo === selectedPartForLogs && report.submittedBy === user.uid)
    : reports.filter(report => report.submittedBy === user.uid);

  const handleDownloadLogSheet = (report) => {
    const logSheetData = createLogSheetData(report, users);

    let csvContent = "";
    csvContent += `Report ID:,${report.id}\n`;
    csvContent += `Part Name:,${logSheetData.meta.partName}\n`;
    csvContent += `Part No:,${logSheetData.meta.partNo}\n`;
    csvContent += `Customer:,${logSheetData.meta.customer}\n`;
    csvContent += `Submission Date:,${logSheetData.meta.submissionDate}\n\n`;

    const headers = Object.keys(logSheetData.characteristics[0]).join(',') + '\n';
    csvContent += headers;

    logSheetData.characteristics.forEach(char => {
      const row = Object.values(char).map(val => `"${val}"`).join(',') + '\n';
      csvContent += row;
    });

    csvContent += '\nRemarks:,"' + (logSheetData.remarks || 'No remarks.') + '"\n\n';

    csvContent += 'Signatures\n';
    csvContent += `Auditor:,${logSheetData.signatures.auditor}\n`;
    csvContent += `Team Leader Audit:,${logSheetData.signatures.teamLeaderAudit}\n`;
    csvContent += `H.O.F. Audit:,${logSheetData.signatures.hofAudit}\n`;
    csvContent += `Quality Head:,${logSheetData.signatures.qualityHead}\n`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `Inspection_Log_${report.id}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    showNotification(`Log sheet for report ${report.id} downloaded successfully!`);
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg border-b-4 border-gray-400">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">Auditor Dashboard</h2>
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          <button onClick={() => setActiveTab('new-report')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition duration-200 ${activeTab === 'new-report' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>New Report</button>
          <button onClick={() => setActiveTab('logs')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition duration-200 ${activeTab === 'logs' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>My Logs</button>
          <button onClick={() => setActiveTab('consumer-report')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition duration-200 ${activeTab === 'consumer-report' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Consumer Report</button>
        </nav>
      </div>

      {activeTab === 'new-report' && (
        <>
          <div className="mb-6">
            <label htmlFor="part-select" className="block text-gray-700 font-semibold mb-2">Select Part to Inspect:</label>
            <select
              id="part-select"
              onChange={(e) => setSelectedPart(parts.find(p => p.partNo === e.target.value))}
              value={selectedPart ? selectedPart.partNo : ''}
              className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
              disabled={!user}
            >
              <option value="" disabled>-- Select a Part --</option>
              {parts.map(part => (
                <option key={part.partNo} value={part.partNo}>{part.partName} ({part.partNo})</option>
              ))}
            </select>
          </div>

          {selectedPart && (
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-gray-700 font-semibold mb-1">Part Name:</label>
                  <input type="text" value={formData.partName} readOnly className="w-full p-3 bg-gray-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-gray-700 font-semibold mb-1">Part No:</label>
                  <input type="text" value={formData.partNo} readOnly className="w-full p-3 bg-gray-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-gray-700 font-semibold mb-1">Customer:</label>
                  <input type="text" value={formData.customer} readOnly className="w-full p-3 bg-gray-200 rounded-lg" />
                </div>
              </div>

              <div className="overflow-x-auto bg-gray-50 rounded-xl p-4 shadow-inner">
                <table className="w-full text-sm text-left text-gray-600">
                  <thead className="text-xs text-gray-700 uppercase bg-gray-200 rounded-lg">
                    <tr>
                      <th scope="col" className="p-2 rounded-tl-lg">Characteristic</th>
                      <th scope="col" className="p-2">Specification</th>
                      <th scope="col" className="p-2">Check Method</th>
                      <th scope="col" className="p-2 text-center">Observation 1</th>
                      <th scope="col" className="p-2 text-center">Observation 2</th>
                      <th scope="col" className="p-2 text-center">Observation 3</th>
                      <th scope="col" className="p-2 text-center">Observation 4</th>
                      <th scope="col" className="p-2 text-center">Observation 5</th>
                      <th scope="col" className="p-2 text-center">Observation 6</th>
                      <th scope="col" className="p-2 rounded-tr-lg text-center">OK/NOT OK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {formData.characteristics.map((char, charIndex) => {
                      const isAllOk = char.observations.every(obs => isObservationOK(obs, char.specification));
                      return (
                        <tr key={charIndex} className="bg-white border-b hover:bg-gray-100">
                          <td className="p-2 font-medium text-gray-900 whitespace-nowrap">{char.name}</td>
                          <td className="p-2">{char.specification}</td>
                          <td className="p-2">{char.checkMethod}</td>
                          {char.observations.map((obs, obsIndex) => (
                            <td key={obsIndex} className="p-2">
                              <input
                                type="number"
                                step="0.01"
                                value={obs}
                                onChange={(e) => handleObservationChange(charIndex, obsIndex, e.target.value)}
                                className="w-full p-1 border rounded-lg text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                                disabled={!user}
                              />
                            </td>
                          ))}
                          <td className="p-2 text-center">
                            <span className={`font-bold ${isAllOk ? 'text-green-600' : 'text-red-600'}`}>
                              {isAllOk ? 'OK' : 'NOT OK'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-6">
                <label htmlFor="remarks" className="block text-gray-700 font-semibold mb-1">Remarks:</label>
                <textarea
                  id="remarks"
                  value={formData.remarks}
                  onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                  rows="3"
                  className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
                  disabled={!user}
                ></textarea>
              </div>

              <button
                type="submit"
                className="mt-6 w-full py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition duration-300 disabled:bg-blue-400 transform hover:scale-105"
                disabled={!user}
              >
                Submit Report
              </button>
            </form>
          )}
        </>
      )}

      {activeTab === 'logs' && (
        <div>
          <h3 className="text-xl font-semibold mb-4 text-gray-700">My Submitted Reports</h3>
          <div className="mb-6">
            <label htmlFor="part-select-logs" className="block text-gray-700 font-semibold mb-2">Filter by Part:</label>
            <select
              id="part-select-logs"
              onChange={(e) => setSelectedPartForLogs(e.target.value)}
              value={selectedPartForLogs}
              className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
            >
              <option value="">-- All Parts --</option>
              {parts.map(part => (
                <option key={part.partNo} value={part.partNo}>{part.partName} ({part.partNo})</option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto bg-gray-50 rounded-xl shadow-inner">
            <table className="min-w-full text-sm text-left text-gray-600">
              <thead className="text-xs text-gray-700 uppercase bg-gray-200 rounded-lg">
                <tr>
                  <th scope="col" className="p-3 rounded-tl-lg">Report ID</th>
                  <th scope="col" className="p-3">Part Name</th>
                  <th scope="col" className="p-3">Status</th>
                  <th scope="col" className="p-3">Submission Date</th>
                  <th scope="col" className="p-3 rounded-tr-lg text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredReportsByPart.length > 0 ? (
                  filteredReportsByPart.map(report => (
                    <tr key={report.id} className="bg-white border-b hover:bg-gray-100">
                      <td className="p-3 font-medium text-gray-900 whitespace-nowrap">{report.id}</td>
                      <td className="p-3">{report.partName}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          report.status === 'Approved' ? 'bg-green-200 text-green-800' :
                          report.status === 'Re-scheduling' ? 'bg-red-200 text-red-800' :
                          'bg-yellow-200 text-yellow-800'
                        }`}>
                          {report.status}
                        </span>
                      </td>
                      <td className="p-3">{formatTimestamp(report.submissionDate)}</td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => handleDownloadLogSheet(report)}
                          className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition duration-300"
                        >
                          Download Log Sheet
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="p-3 text-center text-gray-500">No reports found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'consumer-report' && (
        <ConsumerReportGenerator reports={reports} parts={parts} users={users} />
      )}
    </div>
  );
};

const HigherAuthorityDashboard = ({ role, reports, onSelectReport, selectedReport, onApprove, onReject, showNotification, userId, parts, users, db, appId }) => {
  const [activeTab, setActiveTab] = useState('review');
  const [selectedPartForLogs, setSelectedPartForLogs] = useState('');
  
  const [partNo, setPartNo] = useState('');
  const [partName, setPartName] = useState('');
  const [customer, setCustomer] = useState('');
  const [newCharacteristicName, setNewCharacteristicName] = useState('');
  const [newCharacteristicSpec, setNewCharacteristicSpec] = useState('');
  const [newCharacteristicMethod, setNewCharacteristicMethod] = useState('');
  const [newPartCharacteristics, setNewPartCharacteristics] = useState([]);
  const [editingPart, setEditingPart] = useState(null);
  const [editedPartData, setEditedPartData] = useState({ partNo: '', partName: '', customer: '', characteristics: [] });

  const filteredReportsToReview = reports.filter(report => {
    if (role === 'Team Leader Audit') return report.status === 'Submitted';
    if (role === 'H.O.F. Audit') return report.status === STATUS.TEAM_LEADER_REVIEWED;
    if (role === 'Quality Head') return report.status === STATUS.HOF_REVIEWED;
    return false;
  });

  const filteredReportsByPart = selectedPartForLogs
    ? reports.filter(report => report.partNo === selectedPartForLogs)
    : reports;
  
  const handleDownloadLogSheet = (report) => {
    const logSheetData = createLogSheetData(report, users);
    
    let csvContent = "";
    csvContent += `Report ID:,${report.id}\n`;
    csvContent += `Part Name:,${logSheetData.meta.partName}\n`;
    csvContent += `Part No:,${logSheetData.meta.partNo}\n`;
    csvContent += `Customer:,${logSheetData.meta.customer}\n`;
    csvContent += `Submission Date:,${logSheetData.meta.submissionDate}\n\n`;

    const headers = Object.keys(logSheetData.characteristics[0]).join(',') + '\n';
    csvContent += headers;

    logSheetData.characteristics.forEach(char => {
      const row = Object.values(char).map(val => `"${val}"`).join(',') + '\n';
      csvContent += row;
    });

    csvContent += '\nRemarks:,"' + (logSheetData.remarks || 'No remarks.') + '"\n\n';

    csvContent += 'Signatures\n';
    csvContent += `Auditor:,${logSheetData.signatures.auditor}\n`;
    csvContent += `Team Leader Audit:,${logSheetData.signatures.teamLeaderAudit}\n`;
    csvContent += `H.O.F. Audit:,${logSheetData.signatures.hofAudit}\n`;
    csvContent += `Quality Head:,${logSheetData.signatures.qualityHead}\n`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `Inspection_Log_${report.id}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    
    showNotification(`Log sheet for report ${report.id} downloaded successfully!`);
  };

  const startEditing = (part) => {
    setEditingPart(part);
    setEditedPartData({
      partNo: part.partNo,
      partName: part.partName,
      customer: part.customer,
      characteristics: [...part.characteristics],
    });
    setNewCharacteristicName('');
    setNewCharacteristicSpec('');
    setNewCharacteristicMethod('');
    setActiveTab('edit-part');
  };

  const handleUpdatePart = async (e) => {
    e.preventDefault();
    if (!editingPart || !userId) {
      showNotification("Error: You must be signed in to perform this action.");
      return;
    }

    if (!editedPartData.partNo || !editedPartData.partName || !editedPartData.customer || editedPartData.characteristics.length === 0) {
      showNotification("Error: All fields and at least one characteristic must be filled out.");
      return;
    }

    try {
      const partDocRef = doc(db, `/artifacts/${appId}/public/data/parts`, editingPart.id);
      await updateDoc(partDocRef, {
        partNo: editedPartData.partNo,
        partName: editedPartData.partName,
        customer: editedPartData.customer,
        characteristics: editedPartData.characteristics,
        lastUpdated: new Date()
      });
      showNotification("Part updated successfully!");
      setEditingPart(null);
      setActiveTab('manage-parts');
    } catch (e) {
      console.error("Error updating part:", e);
      showNotification("Error updating part. Please try again.");
    }
  };

  const handleAddCharacteristic = () => {
    if (newCharacteristicName && newCharacteristicSpec && newCharacteristicMethod) {
      if (activeTab === 'add-part') {
        setNewPartCharacteristics([...newPartCharacteristics, {
          name: newCharacteristicName,
          specification: newCharacteristicSpec,
          checkMethod: newCharacteristicMethod
        }]);
      } else if (activeTab === 'edit-part') {
        setEditedPartData(prevData => ({
          ...prevData,
          characteristics: [...prevData.characteristics, {
            name: newCharacteristicName,
            specification: newCharacteristicSpec,
            checkMethod: newCharacteristicMethod,
          }],
        }));
      }
      setNewCharacteristicName('');
      setNewCharacteristicSpec('');
      setNewCharacteristicMethod('');
    } else {
      showNotification("Please fill in all characteristic fields.");
    }
  };
  
  const handleRemoveCharacteristic = (indexToRemove) => {
    if (activeTab === 'add-part') {
      setNewPartCharacteristics(newPartCharacteristics.filter((_, index) => index !== indexToRemove));
    } else if (activeTab === 'edit-part') {
      setEditedPartData(prevData => ({
        ...prevData,
        characteristics: prevData.characteristics.filter((_, index) => index !== indexToRemove),
      }));
    }
  };

  const handleAddPart = async (e) => {
    e.preventDefault();
    if (!userId) {
      showNotification("Error: You must be signed in to perform this action.");
      return;
    }

    if (!partNo || !partName || !customer || newPartCharacteristics.length === 0) {
      showNotification("Error: All fields and at least one characteristic must be filled out.");
      return;
    }

    try {
      const partsCollectionRef = collection(db, `/artifacts/${appId}/public/data/parts`);
      await addDoc(partsCollectionRef, {
        partNo,
        partName,
        customer,
        characteristics: newPartCharacteristics,
        createdAt: new Date()
      });
      showNotification("Part added successfully!");
      setPartNo('');
      setPartName('');
      setCustomer('');
      setNewPartCharacteristics([]);
    } catch (e) {
      console.error("Error adding part:", e);
      showNotification("Error adding part. Please try again.");
    }
  };

  const handleDeletePart = async (partId) => {
    if (window.confirm("Are you sure you want to delete this part? This action cannot be undone.")) {
      try {
        await deleteDoc(doc(db, `/artifacts/${appId}/public/data/parts`, partId));
        showNotification("Part deleted successfully!");
        if (editingPart && editingPart.id === partId) {
          setEditingPart(null);
          setActiveTab('manage-parts');
        }
      } catch (e) {
      }
    }
  };

  const handleDeleteReport = async (reportId) => {
    if (window.confirm("Are you sure you want to delete this report? This action cannot be undone.")) {
      try {
        await deleteDoc(doc(db, `/artifacts/${appId}/public/data/inspectionReports`, reportId));
        showNotification("Report deleted successfully!");
      } catch (e) {
        console.error("Error deleting report:", e);
        showNotification("Error deleting report.");
      }
    }
  };

  const handleRemoveUserAccess = async (userIdToRemove) => {
    const userToRemove = users.find(u => u.id === userIdToRemove);
    if (userToRemove && userToRemove.role === 'Quality Head' && users.filter(u => u.role === 'Quality Head').length === 1) {
      showNotification("Error: You are the last Quality Head. You cannot remove your own or another Quality Head's access.");
      return;
    }

    if (window.confirm("Are you sure you want to remove this user's access? This action cannot be undone.")) {
      try {
        await deleteDoc(doc(db, `/artifacts/${appId}/public/data/users`, userIdToRemove));
        showNotification("User access removed successfully!");
      } catch (e) {
        console.error("Error removing user access:", e);
        showNotification("Error removing user access. Please try again.");
      }
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg border-b-4 border-gray-400">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">{role} Dashboard</h2>

      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          <button onClick={() => { setActiveTab('review'); onSelectReport(null); }} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition duration-200 ${activeTab === 'review' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Review Reports</button>
          <button onClick={() => { setActiveTab('logs'); onSelectReport(null); }} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition duration-200 ${activeTab === 'logs' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Logs</button>
          <button onClick={() => setActiveTab('consumer-report')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition duration-200 ${activeTab === 'consumer-report' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Consumer Report</button>
          {role === 'Quality Head' && (
            <>
              <button onClick={() => { setActiveTab('add-part'); setEditingPart(null); }} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition duration-200 ${activeTab === 'add-part' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Add New Part</button>
              <button onClick={() => { setActiveTab('manage-parts'); setEditingPart(null); }} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition duration-200 ${activeTab === 'manage-parts' || activeTab === 'edit-part' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Manage Parts</button>
              <button onClick={() => { setActiveTab('manage-reports'); setEditingPart(null); }} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition duration-200 ${activeTab === 'manage-reports' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Manage Reports</button>
              <button onClick={() => { setActiveTab('manage-users'); setEditingPart(null); }} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition duration-200 ${activeTab === 'manage-users' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Manage Users</button>
            </>
          )}
        </nav>
      </div>

      {selectedReport ? (
        <ReportView
          report={selectedReport}
          onBack={() => onSelectReport(null)}
          onApprove={onApprove}
          onReject={onReject}
          role={role}
          userId={userId}
          showNotification={showNotification}
        />
      ) : activeTab === 'review' ? (
        <div>
          <h3 className="text-xl font-semibold mb-4 text-gray-700">Reports to Review ({filteredReportsToReview.length})</h3>
          <div className="overflow-x-auto bg-gray-50 rounded-xl shadow-inner">
            <table className="w-full text-sm text-left text-gray-600">
              <thead className="text-xs text-gray-700 uppercase bg-gray-200 rounded-lg">
                <tr>
                  <th scope="col" className="p-3 rounded-tl-lg">Report ID</th>
                  <th scope="col" className="p-3">Part Name</th>
                  <th scope="col" className="p-3">Status</th>
                  <th scope="col" className="p-3">Submission Date</th>
                  <th scope="col" className="p-3 rounded-tr-lg">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredReportsToReview.length > 0 ? (
                  filteredReportsToReview.map(report => (
                    <tr key={report.id} className="bg-white border-b hover:bg-gray-100">
                      <td className="p-3 font-medium text-gray-900 whitespace-nowrap">{report.id}</td>
                      <td className="p-3">{report.partName}</td>
                      <td className="p-3">{report.status}</td>
                      <td className="p-3">{formatTimestamp(report.submissionDate)}</td>
                      <td className="p-3">
                        <button
                          onClick={() => onSelectReport(report)}
                          className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition duration-300 disabled:bg-blue-400 transform hover:scale-105"
                          disabled={!userId}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="p-3 text-center text-gray-500">No reports to review at this time.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === 'logs' ? (
        <div>
          <h3 className="text-xl font-semibold mb-4 text-gray-700">Inspection Logs</h3>
          <div className="mb-6">
            <label htmlFor="part-select-logs" className="block text-gray-700 font-semibold mb-2">Filter by Part:</label>
            <select
              id="part-select-logs"
              onChange={(e) => setSelectedPartForLogs(e.target.value)}
              value={selectedPartForLogs}
              className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
            >
              <option value="">-- All Parts --</option>
              {parts.map(part => (
                <option key={part.partNo} value={part.partNo}>{part.partName} ({part.partNo})</option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto bg-gray-50 rounded-xl shadow-inner">
            <table className="min-w-full text-sm text-left text-gray-600">
              <thead className="text-xs text-gray-700 uppercase bg-gray-200 rounded-lg">
                <tr>
                  <th scope="col" className="p-3 rounded-tl-lg">Report ID</th>
                  <th scope="col" className="p-3">Part Name</th>
                  <th scope="col" className="p-3">Status</th>
                  <th scope="col" className="p-3">Submission Date</th>
                  <th scope="col" className="p-3 rounded-tr-lg text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredReportsByPart.length > 0 ? (
                  filteredReportsByPart.map(report => (
                    <tr key={report.id} className="bg-white border-b hover:bg-gray-100">
                      <td className="p-3 font-medium text-gray-900 whitespace-nowrap">{report.id}</td>
                      <td className="p-3">{report.partName}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          report.status === 'Approved' ? 'bg-green-200 text-green-800' :
                          report.status === 'Re-scheduling' ? 'bg-red-200 text-red-800' :
                          'bg-yellow-200 text-yellow-800'
                        }`}>
                          {report.status}
                        </span>
                      </td>
                      <td className="p-3">{formatTimestamp(report.submissionDate)}</td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => handleDownloadLogSheet(report)}
                          className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition duration-300"
                        >
                          Download Log Sheet
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="p-3 text-center text-gray-500">No reports found for this part.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === 'consumer-report' ? (
        <ConsumerReportGenerator reports={reports} parts={parts} users={users} />
      ) : activeTab === 'add-part' && role === 'Quality Head' ? (
        <div className="max-w-lg mx-auto">
          <h3 className="text-xl font-semibold mb-4 text-gray-700">Add New Part</h3>
          <form onSubmit={handleAddPart} className="space-y-4">
            <div>
              <label htmlFor="partNo" className="block text-gray-700 font-semibold mb-1">Part Number:</label>
              <input
                type="text"
                id="partNo"
                value={partNo}
                onChange={(e) => setPartNo(e.target.value)}
                className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
                required
              />
            </div>
            <div>
              <label htmlFor="partName" className="block text-gray-700 font-semibold mb-1">Part Name:</label>
              <input
                type="text"
                id="partName"
                value={partName}
                onChange={(e) => setPartName(e.target.value)}
                className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
                required
              />
            </div>
            <div>
              <label htmlFor="customer" className="block text-gray-700 font-semibold mb-1">Customer:</label>
              <input
                type="text"
                id="customer"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
                required
              />
            </div>

            <h4 className="text-lg font-semibold mt-6 mb-2">Specifications</h4>
            {newPartCharacteristics.map((char, index) => (
              <div key={index} className="bg-gray-100 p-4 rounded-xl flex items-center justify-between border border-gray-300">
                <div>
                  <p className="font-medium">{char.name}</p>
                  <p className="text-sm text-gray-600">Spec: {char.specification}</p>
                  <p className="text-sm text-gray-600">Method: {char.checkMethod}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveCharacteristic(index)}
                  className="text-red-500 hover:text-red-700 transition duration-300"
                >
                  &times;
                </button>
              </div>
            ))}
            <div className="space-y-2">
              <input
                type="text"
                value={newCharacteristicName}
                onChange={(e) => setNewCharacteristicName(e.target.value)}
                placeholder="Characteristic Name"
                className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500 transition duration-200"
              />
              <input
                type="text"
                value={newCharacteristicSpec}
                onChange={(e) => setNewCharacteristicSpec(e.target.value)}
                placeholder="Specification (e.g., 2x 155.5 0.2)"
                className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500 transition duration-200"
              />
              <input
                type="text"
                value={newCharacteristicMethod}
                onChange={(e) => setNewCharacteristicMethod(e.target.value)}
                placeholder="Check Method (e.g., MICROMETER)"
                className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500 transition duration-200"
              />
              <button
                type="button"
                onClick={handleAddCharacteristic}
                className="w-full py-2 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition duration-300"
              >
                Add Characteristic
              </button>
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition duration-300 transform hover:scale-105"
            >
              Add Part
            </button>
          </form>
        </div>
      ) : activeTab === 'manage-parts' && role === 'Quality Head' ? (
        <div>
          <h3 className="text-xl font-semibold mb-4 text-gray-700">Manage Parts</h3>
          <div className="overflow-x-auto bg-gray-50 rounded-xl shadow-inner">
            <table className="min-w-full text-sm text-left text-gray-600">
              <thead className="text-xs text-gray-700 uppercase bg-gray-200 rounded-lg">
                <tr>
                  <th scope="col" className="p-3 rounded-tl-lg">Part No</th>
                  <th scope="col" className="p-3">Part Name</th>
                  <th scope="col" className="p-3">Customer</th>
                  <th scope="col" className="p-3 rounded-tr-lg text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {parts.map(part => (
                  <tr key={part.id} className="bg-white border-b hover:bg-gray-100">
                    <td className="p-3 font-medium text-gray-900 whitespace-nowrap">{part.partNo}</td>
                    <td className="p-3">{part.partName}</td>
                    <td className="p-3">{part.customer}</td>
                    <td className="p-3 text-center space-x-2">
                      <button
                        onClick={() => startEditing(part)}
                        className="px-4 py-2 text-blue-600 font-semibold rounded-lg hover:bg-blue-100 transition duration-300"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeletePart(part.id)}
                        className="px-4 py-2 text-red-600 font-semibold rounded-lg hover:bg-red-100 transition duration-300"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === 'edit-part' && role === 'Quality Head' && editingPart ? (
        <div className="max-w-lg mx-auto">
          <h3 className="text-xl font-semibold mb-4 text-gray-700">Edit Part: {editingPart.partName}</h3>
          <form onSubmit={handleUpdatePart} className="space-y-4">
            <div>
              <label htmlFor="editPartNo" className="block text-gray-700 font-semibold mb-1">Part Number:</label>
              <input
                type="text"
                id="editPartNo"
                value={editedPartData.partNo}
                onChange={(e) => setEditedPartData({ ...editedPartData, partNo: e.target.value })}
                className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
                required
              />
            </div>
            <div>
              <label htmlFor="editPartName" className="block text-gray-700 font-semibold mb-1">Part Name:</label>
              <input
                type="text"
                id="editPartName"
                value={editedPartData.partName}
                onChange={(e) => setEditedPartData({ ...editedPartData, partName: e.target.value })}
                className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
                required
              />
            </div>
            <div>
              <label htmlFor="editCustomer" className="block text-gray-700 font-semibold mb-1">Customer:</label>
              <input
                type="text"
                id="editCustomer"
                value={editedPartData.customer}
                onChange={(e) => setEditedPartData({ ...editedPartData, customer: e.target.value })}
                className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
                required
              />
            </div>
            <h4 className="text-lg font-semibold mt-6 mb-2">Specifications</h4>
            {editedPartData.characteristics.map((char, index) => (
              <div key={index} className="bg-gray-100 p-4 rounded-xl flex items-center justify-between border border-gray-300">
                <div>
                  <p className="font-medium">{char.name}</p>
                  <p className="text-sm text-gray-600">Spec: {char.specification}</p>
                  <p className="text-sm text-gray-600">Method: {char.checkMethod}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveCharacteristic(index)}
                  className="text-red-500 hover:text-red-700 transition duration-300"
                >
                  &times;
                </button>
              </div>
            ))}
            <div className="space-y-2">
              <input
                type="text"
                value={newCharacteristicName}
                onChange={(e) => setNewCharacteristicName(e.target.value)}
                placeholder="Characteristic Name"
                className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500 transition duration-200"
              />
              <input
                type="text"
                value={newCharacteristicSpec}
                onChange={(e) => setNewCharacteristicSpec(e.target.value)}
                placeholder="Specification (e.g., 2x 155.5 0.2)"
                className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500 transition duration-200"
              />
              <input
                type="text"
                value={newCharacteristicMethod}
                onChange={(e) => setNewCharacteristicMethod(e.target.value)}
                placeholder="Check Method (e.g., MICROMETER)"
                className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500 transition duration-200"
              />
              <button
                type="button"
                onClick={handleAddCharacteristic}
                className="w-full py-2 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition duration-300"
              >
                Add Characteristic
              </button>
            </div>
            <div className="flex space-x-4 mt-6">
              <button
                type="submit"
                className="flex-1 py-3 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 transition duration-300 transform hover:scale-105"
              >
                Update Part
              </button>
              <button
                type="button"
                onClick={() => { setEditingPart(null); setActiveTab('manage-parts'); }}
                className="flex-1 py-3 bg-gray-400 text-white font-semibold rounded-lg shadow-md hover:bg-gray-500 transition duration-300 transform hover:scale-105"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : activeTab === 'manage-reports' && role === 'Quality Head' ? (
        <div>
          <h3 className="text-xl font-semibold mb-4 text-gray-700">Manage Inspection Reports</h3>
          <div className="overflow-x-auto bg-gray-50 rounded-xl shadow-inner">
            <table className="min-w-full text-sm text-left text-gray-600">
              <thead className="text-xs text-gray-700 uppercase bg-gray-200 rounded-lg">
                <tr>
                  <th scope="col" className="p-3 rounded-tl-lg">Report ID</th>
                  <th scope="col" className="p-3">Part Name</th>
                  <th scope="col" className="p-3">Status</th>
                  <th scope="col" className="p-3">Submitted By</th>
                  <th scope="col" className="p-3 rounded-tr-lg">Action</th>
                </tr>
              </thead>
              <tbody>
                {reports.map(report => (
                  <tr key={report.id} className="bg-white border-b hover:bg-gray-100">
                    <td className="p-3 font-medium text-gray-900 whitespace-nowrap">{report.id}</td>
                    <td className="p-3">{report.partName}</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        report.status === 'Approved' ? 'bg-green-200 text-green-800' :
                        report.status === 'Re-scheduling' ? 'bg-red-200 text-red-800' :
                        'bg-yellow-200 text-yellow-800'
                      }`}>
                        {report.status}
                      </span>
                    </td>
                    <td className="p-3">{report.submittedBy}</td>
                    <td className="p-3">
                      <button
                        onClick={() => handleDeleteReport(report.id)}
                        className="px-4 py-2 text-red-600 font-semibold rounded-lg hover:bg-red-100 transition duration-300"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === 'manage-users' && role === 'Quality Head' ? (
        <div>
          <h3 className="text-xl font-semibold mb-4 text-gray-700">Manage User Access</h3>
          <div className="overflow-x-auto bg-gray-50 rounded-xl shadow-inner">
            <table className="min-w-full text-sm text-left text-gray-600">
              <thead className="text-xs text-gray-700 uppercase bg-gray-200 rounded-lg">
                <tr>
                  <th scope="col" className="p-3 rounded-tl-lg">User ID</th>
                  <th scope="col" className="p-3">Email</th>
                  <th scope="col" className="p-3">Role</th>
                  <th scope="col" className="p-3 rounded-tr-lg">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="bg-white border-b hover:bg-gray-100">
                    <td className="p-3 font-medium text-gray-900 whitespace-nowrap">{u.id}</td>
                    <td className="p-3">{u.email}</td>
                    <td className="p-3">{u.role}</td>
                    <td className="p-3">
                      {userId !== u.id && (
                        <button
                          onClick={() => handleRemoveUserAccess(u.id)}
                          className="px-4 py-2 text-red-600 font-semibold rounded-lg hover:bg-red-100 transition duration-300"
                        >
                          Remove Access
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const ReportView = ({ report, onBack, onApprove, onReject, role, userId, showNotification }) => {
  const isTeamLeader = role === 'Team Leader Audit' && report.status === 'Submitted';
  const isHof = role === 'H.O.F. Audit' && report.status === STATUS.TEAM_LEADER_REVIEWED;
  const isQualityHead = role === 'Quality Head' && report.status === STATUS.HOF_REVIEWED;
  const showActions = isTeamLeader || isHof || isQualityHead;
  const [isChecked, setIsChecked] = useState(false);
  const [signature, setSignature] = useState('');

  const handleApprove = () => {
    if (!isChecked) {
      showNotification("Please confirm you have reviewed the report before signing.");
      return;
    }
    if (!signature) {
      showNotification("Please provide your signature before approving.");
      return;
    }

    // Approve only — no reject fallback here
    let newStatus = '';
    if (isTeamLeader) newStatus = STATUS.TEAM_LEADER_REVIEWED;
    else if (isHof) newStatus = STATUS.HOF_REVIEWED;
    else if (isQualityHead) newStatus = STATUS.APPROVED;


    if (newStatus) {
      onApprove(report.id, newStatus);
    } else {
      showNotification("You do not have permission to approve this report at its current stage.");
    }
  };

  const handleReject = () => {
    onReject(report.id);
  };

  const isObservationOK = (observation, specification) => {
    if (observation === '') {
      return true;
    }
    const specMatch = specification.match(/([0-9.]+)\s*±\s*([0-9.]+)/);
    let specValue;
    let tolerance;

    if (specMatch) {
      specValue = parseFloat(specMatch[1]);
      tolerance = parseFloat(specMatch[2]);
    } else {
      const parts = specification.split(' ');
      specValue = parseFloat(parts[0]);
      tolerance = parts.length > 1 ? parseFloat(parts[1]) : 0;
    }
    const obsValue = parseFloat(observation);

    if (isNaN(specValue) || isNaN(obsValue) || isNaN(tolerance)) {
      return false;
    }
    const diff = Math.abs(obsValue - specValue);
    return diff <= tolerance;
  };


  return (
    <div className="bg-gray-50 p-6 rounded-xl shadow-inner">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold text-gray-800">Report Details - {report.id}</h3>
        <button
          onClick={onBack}
          className="px-4 py-2 bg-gray-300 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-400 transition duration-300"
        >
          &larr; Back to Dashboard
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <span className="block text-gray-700 font-semibold">Part Name:</span>
          <span className="text-gray-900">{report.partName}</span>
        </div>
        <div>
          <span className="block text-gray-700 font-semibold">Part No:</span>
          <span className="text-gray-900">{report.partNo}</span>
        </div>
        <div>
          <span className="block text-gray-700 font-semibold">Customer:</span>
          <span className="text-gray-900">{report.customer}</span>
        </div>
        <div>
          <span className="block text-gray-700 font-semibold">Current Status:</span>
          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
            report.status === 'Approved' ? 'bg-green-200 text-green-800' :
            report.status === 'Re-scheduling' ? 'bg-red-200 text-red-800' :
            'bg-yellow-200 text-yellow-800'
          }`}>{report.status}</span>
        </div>
      </div>

      <div className="overflow-x-auto bg-white rounded-xl p-4 shadow-md">
        <table className="w-full text-sm text-left text-gray-600">
          <thead className="text-xs text-gray-700 uppercase bg-gray-200 rounded-lg">
            <tr>
              <th scope="col" className="p-2 rounded-tl-lg">Characteristic</th>
              <th scope="col" className="p-2">Specification</th>
              <th scope="col" className="p-2">Check Method</th>
              <th scope="col" className="p-2 text-center">Observation 1</th>
              <th scope="col" className="p-2 text-center">Observation 2</th>
              <th scope="col" className="p-2 text-center">Observation 3</th>
              <th scope="col" className="p-2 text-center">Observation 4</th>
              <th scope="col" className="p-2 text-center">Observation 5</th>
              <th scope="col" className="p-2 text-center">Observation 6</th>
              <th scope="col" className="p-2 rounded-tr-lg text-center">OK/NOT OK</th>
            </tr>
          </thead>
          <tbody>
            {report.characteristics.map((char, index) => {
              const isAllOk = char.observations.every(obs => isObservationOK(obs, char.specification));
              return (
                <tr key={index} className="bg-white border-b hover:bg-gray-100">
                  <td className="p-2 font-medium text-gray-900 whitespace-nowrap">{char.name}</td>
                  <td className="p-2">{char.specification}</td>
                  <td className="p-2">{char.checkMethod}</td>
                  {char.observations.map((obs, obsIndex) => (
                    <td key={obsIndex} className="p-2 text-center">{obs}</td>
                  ))}
                  <td className="p-2 text-center">
                    <span className={`font-bold ${isAllOk ? 'text-green-600' : 'text-red-600'}`}>
                      {isAllOk ? 'OK' : 'NOT OK'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <span className="block text-gray-700 font-semibold mb-1">Remarks:</span>
        <p className="p-3 bg-white rounded-lg border border-gray-300 shadow-sm">{report.remarks || 'No remarks.'}</p>
      </div>

      <div className="bg-gray-200 p-4 rounded-xl mt-6 shadow-inner">
        <span className="block text-gray-800 font-semibold mb-3">Approval Signatures</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 bg-white rounded-lg shadow-sm">
            <span className="block text-xs text-gray-500">Submitted By Auditor:</span>
            <span className="block font-semibold text-gray-900">{report.submittedBy}</span>
          </div>
          <div className="p-3 bg-white rounded-lg shadow-sm">
            <span className="block text-xs text-gray-500">Team Leader Audit:</span>
            <span className="block font-semibold text-gray-900">{report.teamleaderauditSignature || 'Pending'}</span>
          </div>
          <div className="p-3 bg-white rounded-lg shadow-sm">
            <span className="block text-xs text-gray-500">H.O.F. Audit:</span>
            <span className="block font-semibold text-gray-900">{report.hofauditSignature || 'Pending'}</span>
          </div>
          <div className="p-3 bg-white rounded-lg shadow-sm">
            <span className="block text-xs text-gray-500">Quality Head:</span>
            <span className="block font-semibold text-gray-900">{report.qualityheadSignature || 'Pending'}</span>
          </div>
        </div>
      </div>

      {showActions && (
        <div className="mt-6 flex flex-col sm:flex-row justify-end items-center space-y-4 sm:space-y-0 sm:space-x-4">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isChecked}
              onChange={(e) => setIsChecked(e.target.checked)}
              className="form-checkbox h-5 w-5 text-green-600 rounded"
              disabled={!userId}
            />
            <span className="text-sm font-medium text-gray-700">I have reviewed and confirm this report is accurate.</span>
          </label>
          <input
            type="text"
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="E-Signature (Type your name)"
            className="w-full sm:w-auto p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
            disabled={!userId}
          />
          <button
            onClick={handleReject}
            className="px-6 py-3 bg-red-600 text-white font-semibold rounded-lg shadow-md hover:bg-red-700 transition duration-300 disabled:bg-red-400 transform hover:scale-105"
            disabled={!userId}
          >
            Reject
          </button>
          <button
            onClick={handleApprove}
            className="px-6 py-3 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 transition duration-300 disabled:bg-green-400 transform hover:scale-105"
            disabled={!userId}
          >
            Approve & E-Sign
          </button>
        </div>
      )}
    </div>
  );
};

const createLogSheetData = (report, users) => {
  const getSignature = (signatureId) => {
    const user = users.find(u => u.id === signatureId);
    return user ? user.email : 'Pending';
  };

  const formattedData = {
    meta: {
      partName: report.partName,
      partNo: report.partNo,
      customer: report.customer,
      submissionDate: formatTimestamp(report.submissionDate),
    },
    characteristics: report.characteristics.map(char => {
      const isAllOk = char.observations.every(obs => isObservationOK(obs, char.specification));
      return {
        'Characteristic': char.name,
        'Specification': char.specification,
        'Check Method': char.checkMethod,
        'Observation 1': char.observations[0] || '',
        'Observation 2': char.observations[1] || '',
        'Observation 3': char.observations[2] || '',
        'Observation 4': char.observations[3] || '',
        'Observation 5': char.observations[4] || '',
        'Observation 6': char.observations[5] || '',
        'OK/NOT OK': isAllOk ? 'OK' : 'NOT OK',
      };
    }),
    signatures: {
      auditor: getSignature(report.submittedBy),
      teamLeaderAudit: getSignature(report.teamleaderauditSignature),
      hofAudit: getSignature(report.hofauditSignature),
      qualityHead: getSignature(report.qualityheadSignature),
    },
    remarks: report.remarks,
  };
  return formattedData;
};

// Updated Component for Consumer Report
const ConsumerReportGenerator = ({ reports, parts, users }) => {
  const [reportData, setReportData] = useState({});
  const [months, setMonths] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [loadingReport, setLoadingReport] = useState(true);
  const reportRef = useRef();

  const allCustomers = [...new Set(parts.map(part => part.customer))];

  useEffect(() => {
    setLoadingReport(true);
    if (reports.length > 0 && parts.length > 0) {
      const filteredParts = selectedCustomer
        ? parts.filter(part => part.customer === selectedCustomer)
        : parts;

      const { reportData, months } = createConsumerReportData(reports, filteredParts);
      setReportData(reportData);
      setMonths(months);
    }
    setLoadingReport(false);
  }, [reports, parts, selectedCustomer]);

  const getSignatureEmail = (roleName) => {
    const user = users.find(u => u.role === roleName);
    return user ? user.email : 'N/A';
  };

  const signatures = {
    'Auditor': getSignatureEmail('Auditor'),
    'Team Leader Audit': getSignatureEmail('Team Leader Audit'),
    'H.O.F. Audit': getSignatureEmail('H.O.F. Audit'),
    'Quality Head': getSignatureEmail('Quality Head'),
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Approved':
        return 'bg-green-400';
      case 'Submitted':
        return 'bg-yellow-400';
      case 'Reviewed by Team Leader Audit':
      case 'Reviewed by H.O.F. Audit':
        return 'bg-blue-400';
      case 'Re-scheduling':
        return 'bg-red-400';
      case 'No data':
        return 'bg-gray-300';
      default:
        return 'bg-gray-200';
    }
  };

  const getStatusAbbreviation = (status) => {
    switch (status) {
      case 'Approved':
        return 'A';
      case 'Re-scheduling':
        return 'R';
      case 'Submitted':
        return 'S';
      case 'Reviewed by Team Leader Audit':
      case 'Reviewed by H.O.F. Audit':
        return 'P';
      case 'No data':
        return 'N';
      default:
        return '';
    }
  };

  const handleDownloadPdf = () => {
    const input = reportRef.current;
    if (input) {
      const clone = input.cloneNode(true);
      clone.style.width = '297mm';
      clone.style.padding = '10mm';
      clone.style.backgroundColor = 'white';

      document.body.appendChild(clone);

      html2canvas(clone, { scale: 2 }).then(canvas => {
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF({
          orientation: 'landscape',
          unit: 'mm',
          format: 'a4'
        });
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = canvas.width;
        const imgHeight = canvas.height;
        const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);

        const finalWidth = imgWidth * ratio;
        const finalHeight = imgHeight * ratio;

        const x = (pdfWidth - finalWidth) / 2;
        const y = (pdfHeight - finalHeight) / 2;

        pdf.addImage(imgData, 'PNG', x, y, finalWidth, finalHeight);
        pdf.save(`Consumer_Report_${selectedCustomer || 'AllCustomers'}_${new Date().toLocaleDateString('en-GB').replace(/\//g, '-')}.pdf`);

        document.body.removeChild(clone);
      });
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg border-b-4 border-gray-400">
      <h3 className="text-2xl font-bold mb-4 text-gray-800">Consumer Report</h3>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 space-y-4 sm:space-y-0 sm:space-x-4">
        <div className="flex-grow">
          <label htmlFor="customer-select" className="block text-gray-700 font-semibold mb-2">Select Customer:</label>
          <select
            id="customer-select"
            value={selectedCustomer}
            onChange={(e) => setSelectedCustomer(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
          >
            <option value="">-- All Customers --</option>
            {allCustomers.map(customer => (
              <option key={customer} value={customer}>{customer}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleDownloadPdf}
          className="px-6 py-3 bg-red-600 text-white font-semibold rounded-lg shadow-md hover:bg-red-700 transition duration-300 transform hover:scale-105"
        >
          Download PDF
        </button>
      </div>

      {loadingReport ? (
        <div className="flex items-center justify-center p-8 bg-gray-50 rounded-xl">
            <p className="text-gray-600">Generating report...</p>
        </div>
      ) : (
        <div ref={reportRef} className="p-4 bg-white rounded-xl">
          <div className="flex items-center justify-between">
              <h4 className="text-2xl font-bold text-gray-800">SAKTHI AUTO - PRODUCT AUDIT PLAN</h4>
              <p className="text-md font-medium text-gray-600">Date: {new Date().toLocaleDateString('en-GB')}</p>
          </div>
          <h5 className="text-lg font-semibold text-gray-700 my-2">Customer: {selectedCustomer || 'All Customers'}</h5>
          <div className="overflow-x-auto border border-gray-300 rounded-lg">
            <table className="w-full text-sm text-left text-gray-600">
              <thead className="text-xs text-gray-700 uppercase bg-gray-200">
                <tr>
                  <th scope="col" className="p-3 border-r border-gray-300">PART NAME / PART NO</th>
                  {months.map(month => (
                    <th key={month} scope="col" className="p-3 text-center border-r border-gray-300">{month}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parts.filter(part => !selectedCustomer || part.customer === selectedCustomer).map(part => (
                  <tr key={part.partNo} className="bg-white border-b border-gray-300">
                    <td className="p-3 font-medium text-gray-900 whitespace-nowrap border-r border-gray-300">{part.partName} / {part.partNo}</td>
                    {months.map(month => {
                      const status = reportData[part.partNo]?.[month] || 'No data';
                      const statusAbbr = getStatusAbbreviation(status);
                      const colorClass = getStatusColor(status);
                      return (
                        <td key={`${part.partNo}-${month}`} className={`p-3 text-center border-r border-gray-300 ${colorClass}`}>
                          {statusAbbr}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="my-6">
              <h5 className="text-md font-semibold text-gray-700 mb-2">Legend:</h5>
              <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center">
                      <span className="w-4 h-4 inline-block bg-green-400 mr-2"></span>
                      <span className="font-semibold text-sm">A:</span> <span className="text-sm ml-1">Approved by Quality Head</span>
                  </div>
                  <div className="flex items-center">
                      <span className="w-4 h-4 inline-block bg-red-400 mr-2"></span>
                      <span className="font-semibold text-sm">R:</span> <span className="text-sm ml-1">Re-scheduling</span>
                  </div>
                  <div className="flex items-center">
                      <span className="w-4 h-4 inline-block bg-yellow-400 mr-2"></span>
                      <span className="font-semibold text-sm">S:</span> <span className="text-sm ml-1">Submitted</span>
                  </div>
                  <div className="flex items-center">
                      <span className="w-4 h-4 inline-block bg-blue-400 mr-2"></span>
                      <span className="font-semibold text-sm">P:</span> <span className="text-sm ml-1">Reviewed (Team Leader/HOF)</span>
                  </div>
                  <div className="flex items-center">
                      <span className="w-4 h-4 inline-block bg-gray-300 mr-2"></span>
                      <span className="font-semibold text-sm">N:</span> <span className="text-sm ml-1">No data / Unplanned audit</span>
                  </div>
              </div>
          </div>

          <div className="mt-8">
              <h5 className="text-md font-semibold text-gray-700 mb-2">Signatures:</h5>
              <p className="text-sm">Auditor: {signatures.Auditor}</p>
              <p className="text-sm">Team Leader Audit: {signatures['Team Leader Audit']}</p>
              <p className="text-sm">H.O.F. Audit: {signatures['H.O.F. Audit']}</p>
              <p className="text-sm">Quality Head: {signatures['Quality Head']}</p>
          </div>
        </div>
      )}
    </div>
  );
};

const createConsumerReportData = (reports, parts) => {
  const reportData = {};
  const months = [];
  const today = new Date();

  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push(d.toLocaleString('default', { month: 'short', year: 'numeric' }));
  }

  parts.forEach(part => {
    reportData[part.partNo] = {};
    months.forEach(month => {
      reportData[part.partNo][month] = 'No data';
    });
  });

  reports.forEach(report => {
    if (report.submissionDate && report.partNo) {
      const reportDate = report.submissionDate.toDate();
      const reportMonth = reportDate.toLocaleString('default', { month: 'short', year: 'numeric' });

      if (reportData[report.partNo]) {
        const existingReport = reports.find(r =>
          r.partNo === report.partNo &&
          r.submissionDate?.toDate().toLocaleString('default', { month: 'short', year: 'numeric' }) === reportMonth
        );

        if (!existingReport || reportDate > existingReport.submissionDate.toDate()) {
          reportData[report.partNo][reportMonth] = report.status;
        }
      }
    }
  });

  return { reportData, months };
};

export default App;