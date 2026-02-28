const eyes = document.getElementById("eyes");
const mouth = document.getElementById("mouth");
const button = document.getElementById("talk");

async function talkToEmo() {
    // Micro + speech recognition
    const stream = await navigator.mediaDevices.getUserMedia({audio:true,video:true});
    const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.lang = 'fr-FR';
    recognition.start();

    recognition.onresult = (event) => {
        const userText = event.results[0][0].transcript.toLowerCase();
        console.log("Utilisateur:", userText);

        if(userText.includes("emo")) {
            mouth.textContent = "o";
            const reply = emoBrain(userText);
            speak(reply);
            mouth.textContent = "◡";
            setTimeout(()=>mouth.textContent="_",1500);
        }
    };

    // afficher caméra
    const video = document.createElement("video");
    video.srcObject = stream;
    video.autoplay = true;
    video.width = 200;
    document.body.appendChild(video);
}

// personnalite hypocrite / sarcastique
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

// animation yeux clignotants
setInterval(()=>{
    eyes.textContent = "•   •";
    setTimeout(()=>{eyes.textContent="-   -";},150);
},Math.random()*4000+2000);

button.onclick = talkToEmo;