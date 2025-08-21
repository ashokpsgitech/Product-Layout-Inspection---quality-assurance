# **Quality Control and Audit Management System**

This is a web-based Quality Control and Audit Management System designed to streamline inspection and reporting processes within an organization. It provides a multi-user environment where different roles—from auditors to quality heads—can collaborate on creating, reviewing, and approving inspection reports in real-time.

### **Key Features**

* **Multi-Role Authentication:** Secure sign-up and login with different access levels for Auditors, Team Leaders, H.O.F. Auditors, and Quality Heads.  
* **Email Verification & Password Reset:** New users must verify their email to activate their account. Users can also request a password reset link via email.  
* **Real-time Data Management:** All reports and part data are stored in a real-time Firestore database, ensuring all users have access to the latest information.  
* **Digital Inspection Reports:** Auditors can create new inspection reports for different parts, entering observations against predefined specifications.  
* **Hierarchical Approval Workflow:** Reports follow a clear, linear approval process: Submitted \-\> Reviewed by Team Leader \-\> Reviewed by H.O.F. Audit \-\> Approved by Quality Head.  
* **Management Dashboards:** Each role has a dedicated dashboard with tailored functionalities:  
  * **Auditor:** Create new reports and view the status of their submitted logs.  
  * **Team Leader/H.O.F. Audit:** Review reports submitted to them and approve or reject them, pushing the report to the next stage.  
  * **Quality Head:** Oversee all reports, manage parts, and control user access.  
* **Automated Consumer Reports:** The app generates a comprehensive consumer report on the fly, summarizing the audit status of all parts over the last 12 months.  
* **Export Functionality:** Users can download detailed log sheets as CSV files and consumer reports as PDF documents.

### **How It Works**

The application is built as a single-page React application powered by Firebase.

1. **Authentication:** Users sign up with an email, password, and an authentication code that determines their role. This creates a user record in the Firebase Authentication service and a corresponding role document in a Firestore database.  
2. **Data Storage:**  
   * **User Data:** User roles and details are stored in the users collection.  
   * **Part Data:** Quality Heads can define new parts and their characteristics (specifications, check methods) in the parts collection.  
   * **Report Data:** When an auditor submits a report, it is saved to the inspectionReports collection.  
3. **Workflow:** The application's UI dynamically changes based on the logged-in user's role. It displays reports relevant to that role's review stage, enabling a seamless hand-off from one approval level to the next.  
4. **Reporting:** The consumer report feature fetches all relevant data from the Firestore database and uses JavaScript to dynamically generate a visual audit plan, which can then be converted to a downloadable PDF.

### **Technologies Used**

* **Frontend:** React.js  
* **Styling:** Tailwind CSS  
* **State Management:** React's built-in useState and useEffect hooks  
* **Backend & Database:** Firebase Authentication and Firestore  
* **PDF Generation:** jspdf and html2canvas for client-side PDF export  
* **CSV Generation:** JavaScript native Blob object

### **Getting Started**

To get the application up and running, follow these steps:

#### **Step 1: Firebase Setup**

1. **Create a Firebase Project:** Go to the [Firebase Console](https://console.firebase.google.com/) and create a new project.  
2. **Add a Firestore Database:** In your new project, navigate to **Build \> Firestore Database** and click "Create database." Choose a security mode (Start in test mode is easiest for development) and a location.  
3. **Configure Security Rules:** Go to the **Rules** tab for your Firestore Database. Copy the content from the firebase-rules.txt file (provided below) and paste it into the rules editor, then click "Publish."  
4. **Add Your App to the Project:** In your project's **Project settings** (⚙️ \> **Project settings**), go to the **General** tab. Under "Your apps," add a new web app and follow the steps. This will give you the firebaseConfig object.  
5. **Update App.js:** Open src/App.js and replace the placeholder firebaseConfig object on line 42 with the credentials you just obtained from your Firebase project.  
   // ...  
   const firebaseConfig \= {  
     apiKey: "YOUR\_API\_KEY",  
     authDomain: "YOUR\_AUTH\_DOMAIN",  
     projectId: "YOUR\_PROJECT\_ID",  
     storageBucket: "YOUR\_STORAGE\_BUCKET",  
     messagingSenderId: "YOUR\_MESSAGING\_SENDER\_ID",  
     appId: "YOUR\_APP\_ID",  
     measurementId: "YOUR\_MEASUREMENT\_ID"  
   };  
   // ...

#### **Step 2: Local Setup**

1. **Install Node.js:** If you don't already have it, download and install Node.js (LTS version recommended) from [nodejs.org](https://nodejs.org/).  
2. **Clone the repository:**  
   git clone https://github.com/ashokpsgitech/Product-Layout-Inspection---quality-assurance.git  
   cd Product-Layout-Inspection---quality-assurance

3. **Install dependencies:** In your command prompt or terminal, navigate to the project's parent folder and run:  
   npm install

4. **Run the application:** Once the installation is complete, start the application with:  
   npm start

   The application will be available at http://localhost:3000.

### **Code Structure**

The core logic resides in a single App.js file, composed of several functional React components:

* App.js: The main component handling global state (user, authentication), routing between pages, and data fetching listeners.  
* LoginForm, SignupForm, ForgotPasswordForm: Components for user authentication.  
* VerificationPrompt: A new component to guide users through the email verification process.  
* AuditorDashboard: The main interface for Auditors to submit new reports and view their logs.  
* HigherAuthorityDashboard: The main interface for Team Leaders, H.O.F. Auditors, and Quality Heads to review reports and manage parts and users.  
* ReportView: A detailed view of a single report for review and approval.  
* ConsumerReportGenerator: The component that generates and displays the high-level audit plan.

### **Contributing**

Contributions are welcome\! If you have suggestions for new features, bug fixes, or improvements, please open an issue or submit a pull request.

### **License**

This project is licensed under the MIT License