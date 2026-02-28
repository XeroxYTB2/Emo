const eyes = document.getElementById("eyes");
const mouth = document.getElementById("mouth");

// personnalité hypocrite
function emoBrain(text) {
    const replies = [
        `Oh… ${text}? Fascinant. Presque inattendu venant de toi.`,
        `Tu demandes « ${text} » ? Quelle audace intellectuelle.`,
        `Bien sûr. ${text}. Je fais semblant d’être impressionné.`,
        `${text} ? Hmm. Je suppose que quelqu’un devait poser la question.`
    ];
    return replies[Math.floor(Math.random()*replies.length)];
}

// synthèse vocale
function speak(text) {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang='fr-FR';
    window.speechSynthesis.speak(utter);
}

// yeux clignotants
setInterval(()=>{
    eyes.textContent = "•   •";
    setTimeout(()=>{eyes.textContent="-   -";},150);
},Math.random()*4000+2000);

// -------- reconnaissance vocale --------
async function startListening() {
    const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.lang = 'fr-FR';
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
        const text = event.results[event.results.length-1][0].transcript.toLowerCase();
        console.log("Utilisateur:", text);

        if(text.includes("emo")) {
            mouth.textContent = "o";
            const reply = emoBrain(text);
            speak(reply);
            mouth.textContent = "◡";
            setTimeout(()=>mouth.textContent="_",1500);
        }
    };

    // start recognition
    recognition.start();

    recognition.onerror = (event) => {
        console.error(event.error);
        recognition.stop();
        setTimeout(()=>recognition.start(),1000);
    };
}

startListening();