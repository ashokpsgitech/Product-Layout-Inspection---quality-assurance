step1: Create database and authentication in firebase

Step2: copy the rules from the "firebase rules.txt" file and add them in the rules page of the created database(firebase)

step3: replace this part in src/App.js file line 42


	const firebaseConfig = {
  		apiKey:       ,
  		authDomain:         ,
  		projectId:        ,
  		storageBucket:        ,
  		messagingSenderId:       ,
  		appId:         ,
  		measurementId: 
	};


	with the original credentials of your project created in firebase
		Project settings  ->  General -> your apps

step4: from the parent folder run the following command(node js must be installed)
		"npm start"
