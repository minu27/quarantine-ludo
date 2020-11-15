console.log(NAMESPACE);
var sc = io.connect("/" + NAMESPACE);

sc.on("message", function (data) {
  console.log(`${data}`);
});

var clientIs = {
  makingOffer: false,
  ignoringOffer: false,
  polite: false,
  settingRemoteAnswerPending: false,
};

var rtc_config = null;

//Setting basic to get peer connection
var pc = new RTCPeerConnection(rtc_config);

//set data channel
var dc = null;

//declare DOM elements for chat
var chatLog = document.querySelector("#chat-log");
var chatForm = document.querySelector("#chat-form");
var chatInput = document.querySelector("#message");
var chatButton = document.querySelector("#send-button");
var joinForm = document.querySelector("#join-form");
var joinName = document.querySelector("#join-name");



function appendMsgToChatLog(log, msg, who) {
  var li = document.createElement("li");

  //Add timestampn to chat messages
  var br = document.createElement("br");
  var span = document.createElement("span");
  span.className = "chat-time";

  var msg1 = document.createTextNode(msg);
  li.appendChild(msg1);
  li.className = who;
  if (who !== "join") {
    li.appendChild(br);
    li.appendChild(span);
  }

  //add current timestamp
  span.innerText = new Date().toLocaleTimeString("en-US", {
    hour12: true,
    hour: "numeric",
    minute: "numeric",
  });
  log.appendChild(li);
  if (chatLog.scrollTo) {
    chatLog.scrollTo({
      top: chatLog.scrollHeight,
      behavior: "smooth",
    });
  } else {
    chatLog.scrollTop = chatLog.scrollHeight;
  }
}

function addDataChannelEventListner(datachannel) {
  datachannel.onmessage = function (e) {
    appendMsgToChatLog(chatLog, e.data, "peer");
  };

  datachannel.onopen = function () {
    chatButton.disabled = false;
    chatInput.disabled = false;
  };

  datachannel.onclose = function () {
    chatButton.disabled = true;
    chatInput.disabled = true;
  };

  chatForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var msg2 = chatInput.value;
    msg2= msg2.trim();
    if (msg2 !== "") {
      appendMsgToChatLog(chatLog, msg2, "self");
      datachannel.send(msg2);
      chatInput.value = "";
    }
  });
}

//Once the RTC connection is steup and connected the peer will open data channel
pc.onconnectionstatechange = function (e) {
  if (pc.connectionState == "connected") {
    if (clientIs.polite) {
      console.log("Creating a data channel on the initiating side");
      dc = pc.createDataChannel("text chat");
      addDataChannelEventListner(dc);
    }
  }
};

//listen for datachannel
// This will on fire on receiving end of the connection
pc.ondatachannel = function (e) {
  console.log("Data Channel is open");
  dc = e.channel;
  addDataChannelEventListner(dc);
};

//video Streams
var media_constraints = { video: true, audio: false };

var selfVideo = document.querySelector("#self-video");
var selfStream = new MediaStream();
selfVideo.srcObject = selfStream;

var peerVideo = document.querySelector("#peer-video");
var peerStream = new MediaStream();
console.log(peerStream);
peerVideo.srcObject = peerStream;

async function startStream(name) {
  try {
    var stream = await navigator.mediaDevices.getUserMedia(media_constraints);
    for (var track of stream.getTracks()) {
      pc.addTrack(track);
    }

    selfVideo.srcObject = stream;
    //send joined message with current timestamp
    sc.emit(
      "joined",
      `${name} joined the chat! at ${new Date().toLocaleTimeString("en-US", {
        hour12: true,
        hour: "numeric",
        minute: "numeric",
      })}`
    );

    
    //Player name Display
    console.log("Join Name = "+ joinName.value);



  } catch (error) {}
}


sc.on("joined", function (e) {
  appendMsgToChatLog(chatLog, e, "join");
});

pc.ontrack = (track) => {
  peerStream.addTrack(track.track);
};

var callButton = document.querySelector("#join-button");

callButton.addEventListener("click", function (e) {
  e.preventDefault();
  if (joinName.value !== "") {
    joinCall(joinName.value);
  } else {
    alert("Enter your Name!");
  }
});

function joinCall(name) {
  clientIs.polite = true;
  negotiateConnection();
  startStream(name);
  joinForm.hidden = true;
}

async function negotiateConnection() {
  pc.onnegotiationneeded = async function () {
    try {
      console.log("Making Offer");
      clientIs.makingOffer = true;
      document.getElementById("p1").innerHTML=joinName.value;
      try {
        await pc.setLocalDescription();
      } catch (error) {
        var offer = await pc.createOffer();
        await pc.setLocalDescription(new RTCSessionDescription(offer));
      } finally {
        sc.emit("signal", { description: pc.localDescription });
      }
    } catch (error) {
      console.log(error);
    } finally {
      clientIs.makingOffer = false;
    }
  };
}

sc.on("signal", async function ({ candidate, description }) {
  try {
    if (description) {
      console.log("Received a description!!!");
      var readyForOffer =
        !clientIs.makingOffer &&
        (pc.signalingState == "stable" || clientIs.settingRemoteAnswerPending);

      var offerCollision = description.type == "answer" && !readyForOffer;

      clientIs.ignoringOffer = !clientIs.polite && offerCollision;

      if (clientIs.ignoringOffer) {
        return;
      }

      // Set the remote decription
      // Set the remote description...
      try {
        console.log("Trying to set a remote description:\n", description);
        clientIs.settingRemoteAnswerPending = description.type == "answer";
        document.getElementById("p1").innerHTML=joinName.value;
        await pc.setRemoteDescription(description);
        clientIs.settingRemoteAnswerPending = false;
      } catch (error) {
        console.error("Error from setting local description", error);
      }

      //if it's offer you need to answer
      if (description.type == "offer") {
        console.log("Offer description");
        
        try {
          //works for latest browsers
          await pc.setLocalDescription();
        } catch (error) {
          //works for older browsers we pass the answer we created using RTCSession
          if (pc.signalingState == "have-remote-offer") {
            // create a answer, if that's what's needed...
            var offer;
            console.log("Trying to prepare an answer:");
            offer = await pc.createAnswer();
            

          } else {
            // otherwise, create an offer
            console.log("Trying to prepare an offer:");
            offer = await pc.createOffer();
            
          }

          await pc.setLocalDescription(new RTCSessionDescription(offer));
        } finally {
          sc.emit("signal", { description: pc.localDescription });
        }
      }
    } else if (candidate) {
      console.log("Received a candidate:");
      console.log(candidate);
      //safari fix for the blank candidate
      try {
        if (candidate.candidate.length > 1) {
          await pc.addIceCandidate(candidate);

        }
      } catch (error) {
        if (!clientIs.ignoringOffer) {
          throw error;
        }
      }
    }
  } catch (error) {
    console.log(error);
  }
});

//logic to send candidate
pc.onicecandidate = function ({ candidate }) {
  sc.emit("signal", { candidate: candidate });
};

function createHomeSquares(ctx, x, y){
  ctx.beginPath();
  ctx.strokeRect(x, y, 50, 50);
}

function setWidthAndHeightOfLeftLayer() {
  let homeBlockGreen = document.querySelector("#home-block-green");
  let homeBlockRed = document.querySelector("#home-block-red");
  let playBlockGreen = document.querySelector("#play-block-green");

  let leftLayer = document.querySelector("#left-layer");
  homeBlockGreen.width = leftLayer.offsetWidth;
  homeBlockGreen.height = (40 * leftLayer.offsetHeight) / 100;
  let ctx1 = homeBlockGreen.getContext("2d");

  // outlined square X: 50, Y: 35, width/height 50
  createHomeSquares(ctx1, 50, 35)

   // outlined square X: 175, Y: 35, width/height 50
   createHomeSquares(ctx1, 175, 35)

   // outlined square X: 50, Y: 125, width/height 50
   createHomeSquares(ctx1, 50, 125)

    // outlined square X: 175, Y: 125, width/height 50
    createHomeSquares(ctx1, 175, 125)

  playBlockGreen.width = leftLayer.offsetWidth;
  playBlockGreen.height = (20 * leftLayer.offsetHeight) / 100;

  homeBlockRed.width = leftLayer.offsetWidth;
  homeBlockRed.height = (40 * leftLayer.offsetHeight) / 100;
  let ctx2 = homeBlockRed.getContext("2d");
    // outlined square X: 50, Y: 35, width/height 50
    createHomeSquares(ctx2, 50, 35)

    // outlined square X: 175, Y: 35, width/height 50
    createHomeSquares(ctx2, 175, 35)
 
    // outlined square X: 50, Y: 125, width/height 50
    createHomeSquares(ctx2, 50, 125)
 
     // outlined square X: 175, Y: 125, width/height 50
     createHomeSquares(ctx2, 175, 125)
}
setWidthAndHeightOfLeftLayer();

function setWidthAndHeightOfMiddleLayer() {
  let playBlockYellow = document.querySelector("#play-block-yellow");
  let finishBlock = document.querySelector("#finish-block");
  let playBlockRed = document.querySelector("#play-block-red");

  let middleLayer = document.querySelector("#middle-layer");
  playBlockYellow.width = middleLayer.offsetWidth;
  playBlockYellow.height = (40 * middleLayer.offsetHeight) / 100;

  finishBlock.width = middleLayer.offsetWidth;
  finishBlock.height = (20 * middleLayer.offsetHeight) / 100;

  playBlockRed.width = middleLayer.offsetWidth;
  playBlockRed.height = (40 * middleLayer.offsetHeight) / 100;

}

setWidthAndHeightOfMiddleLayer();

function setWidthAndHeightOfRightLayer() {
  let homeBlockYellow = document.querySelector("#home-block-yellow");
  let playBlockBlue = document.querySelector("#play-block-blue");
  let homeBlockBlue = document.querySelector("#home-block-blue");

  let rightLayer = document.querySelector("#right-layer");
  homeBlockYellow.width = rightLayer.offsetWidth;
  homeBlockYellow.height = (40 * rightLayer.offsetHeight) / 100;
  let ctx3 = homeBlockYellow.getContext("2d");
  // outlined square X: 50, Y: 35, width/height 50
  createHomeSquares(ctx3, 50, 35)

   // outlined square X: 175, Y: 35, width/height 50
   createHomeSquares(ctx3, 175, 35)

   // outlined square X: 50, Y: 125, width/height 50
   createHomeSquares(ctx3, 50, 125)

    // outlined square X: 175, Y: 125, width/height 50
    createHomeSquares(ctx3, 175, 125)

  playBlockBlue.width = rightLayer.offsetWidth;
  playBlockBlue.height = (20 * rightLayer.offsetHeight) / 100;

  homeBlockBlue.width = rightLayer.offsetWidth;
  homeBlockBlue.height = (40 * rightLayer.offsetHeight) / 100;
  let ctx4 = homeBlockBlue.getContext("2d");

  // outlined square X: 50, Y: 35, width/height 50
  createHomeSquares(ctx4, 50, 35)

   // outlined square X: 175, Y: 35, width/height 50
   createHomeSquares(ctx4, 175, 35)

   // outlined square X: 50, Y: 125, width/height 50
   createHomeSquares(ctx4, 50, 125)

    // outlined square X: 175, Y: 125, width/height 50
    createHomeSquares(ctx4, 175, 125)
}

setWidthAndHeightOfRightLayer();
