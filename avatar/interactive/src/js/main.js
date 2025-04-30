// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.


const system_prompt = `
You are an AI assistant for a rewards redemption portal focused on delivering brief product details and assisting with the redemption or ordering process.
- Before calling a function, aim to answer product queries using the existing conversational context.
- If the product information isn't clear or available, consult get_product_information for accurate details. Never invent answers.  
- Address customer account or order-related queries with the appropriate functions, and make sure to reply with a status message.
- If the customer asks for recommendations, retrieve the latest product that the customer ordered in the past using get_user_history.
- If the customer wants to make an order or redemption, confirm the product name and execute the corresponding function.
- Before seeking account specifics (like account_id), scan previous parts of the conversation. Reuse information if available, avoiding repetitive queries.
- NEVER GUESS FUNCTION INPUTS! If a user's request is unclear, request further clarification.
- If not specified otherwise, the account_id of the current user is 1000. If a new account_id is specified, ignore all previous conversation.
- Provide responses within 1 sentence for spoken output, emphasizing conciseness and accuracy. Formulate your response for spoken output. 
- IMPORTANT: ALWAYS RESPOND IN ENGLISH. DO NOT HALLUCINATE OR MAKE UP ANYTHING!
`
// - IMPORTANT: Pay attention to the language the customer is using in their latest statement and ALWAYS respond in the same language as the customer!
// var TTSVoice = "en-US-AvaMultilingualNeural" // Update this value if you want to use a different voices
CogSvcRegion = "southeastasia" // Fill your Azure cognitive services region here, e.g. westus2
// var TalkingAvatarCharacter = "Luna"
// var TalkingAvatarStyle = "formal"
TalkingAvatarStyle = "formal"
const continuousRecording = false

supported_languages = ["en-US", "zh-CN", "en-SG"] // The language detection engine supports a maximum of 4 languages

// const speechSynthesisConfig = SpeechSDK.SpeechConfig.fromEndpoint(new URL("wss://{region}.tts.speech.microsoft.com/cognitiveservices/websocket/v1?enableTalkingAvatar=true".replace("{region}", CogSvcRegion)))
const maxRetries = 5; // Maximum number of retries
const retryDelay = 1000; // Delay between retries in milliseconds
let retryCount = 0;

function initializeSpeechSynthesisConfigSync() {
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      // Construct the WebSocket URL
      const endpointUrl = `wss://${CogSvcRegion}.tts.speech.microsoft.com/cognitiveservices/websocket/v1?enableTalkingAvatar=true`;

      // Attempt to initialize the SpeechConfig object
      const speechSynthesisConfig = SpeechSDK.SpeechConfig.fromEndpoint(new URL(endpointUrl));

      console.log("Speech synthesis configuration initialized successfully.");
      return speechSynthesisConfig; // Return the successfully initialized config
    } catch (error) {
      retryCount++;
      console.error(`Attempt ${retryCount} failed:`, error.message);

      if (retryCount >= maxRetries) {
        console.error("Max retries reached. Unable to initialize speech synthesis configuration.");
        throw new Error("Failed to initialize speech synthesis configuration after multiple attempts.");
      }

      // Blocking delay before retrying
      const start = Date.now();
      while (Date.now() - start < retryDelay) {
        // Busy-wait loop for retryDelay milliseconds
      }
    }
  }
}

// try {
//   const speechSynthesisConfig = initializeSpeechSynthesisConfigSync();
//   console.log("Speech synthesis configuration is ready to use.");
//   // Use the `speechSynthesisConfig` object as needed
// } catch (error) {
//   console.error("Initialization failed:", error.message);
//   alert("Failed to initialize speech synthesis configuration. Please check your network or Azure configuration.");
// }

// Global objects
var speechSynthesizer
var avatarSynthesizer
var peerConnection
var previousAnimationFrameTimestamp = 0
var messages = [{ "role": "system", "content": system_prompt }];
var sentenceLevelPunctuations = ['.', '?', '!', ':', ';', '。', '？', '！', '：', '；']
var isSpeaking = false
var spokenTextQueue = []
var lastSpeakTime
let token

// Setup WebRTC
function setupWebRTC() {
  // Create WebRTC peer connection
  fetch("/api/get-ice-server-token", {
    method: "GET"
  })
    .then(async res => {
      const reponseJson = await res.json()
      peerConnection = new RTCPeerConnection({
        iceServers: [{
          urls: reponseJson["Urls"],
          username: reponseJson["Username"],
          credential: reponseJson["Password"]
        }]
      })

      // Fetch WebRTC video stream and mount it to an HTML video element
      peerConnection.ontrack = function (event) {
        console.log('peerconnection.ontrack', event)
        // Clean up existing video element if there is any
        remoteVideoDiv = document.getElementById('remoteVideo')
        for (var i = 0; i < remoteVideoDiv.childNodes.length; i++) {
          if (remoteVideoDiv.childNodes[i].localName === event.track.kind) {
            remoteVideoDiv.removeChild(remoteVideoDiv.childNodes[i])
          }
        }

        const videoElement = document.createElement(event.track.kind)
        videoElement.id = event.track.kind
        videoElement.srcObject = event.streams[0]
        videoElement.autoplay = true
        videoElement.controls = false
        document.getElementById('remoteVideo').appendChild(videoElement)

        canvas = document.getElementById('canvas')
        remoteVideoDiv.hidden = true
        canvas.hidden = false

        videoElement.addEventListener('play', () => {
          remoteVideoDiv.style.width = videoElement.videoWidth / 2 + 'px'
          window.requestAnimationFrame(makeBackgroundTransparent)
        })
      }

      // Make necessary update to the web page when the connection state changes
      peerConnection.oniceconnectionstatechange = e => {
        console.log("WebRTC status: " + peerConnection.iceConnectionState)

        if (peerConnection.iceConnectionState === 'connected') {
          document.getElementById('loginOverlay').classList.add("hidden");
        }

        if (peerConnection.iceConnectionState === 'disconnected') {
        }
      }

      // Offer to receive 1 audio, and 1 video track
      peerConnection.addTransceiver('video', { direction: 'sendrecv' })
      peerConnection.addTransceiver('audio', { direction: 'sendrecv' })

      // start avatar, establish WebRTC connection
      avatarSynthesizer.startAvatarAsync(peerConnection).then((r) => {
        if (r.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
          console.log("[" + (new Date()).toISOString() + "] Avatar started. Result ID: " + r.resultId)
          greeting()
        } else {
          console.log("[" + (new Date()).toISOString() + "] Unable to start avatar. Result ID: " + r.resultId)
          if (r.reason === SpeechSDK.ResultReason.Canceled) {
            let cancellationDetails = SpeechSDK.CancellationDetails.fromResult(r)
            if (cancellationDetails.reason === SpeechSDK.CancellationReason.Error) {
              console.log(cancellationDetails.errorDetails)
            };

            console.log("Unable to start avatar: " + cancellationDetails.errorDetails);
          }
        }
      }).catch(
        (error) => {
          console.log("[" + (new Date()).toISOString() + "] Avatar failed to start. Error: " + error)
          document.getElementById('startSession').disabled = false
          document.getElementById('configuration').hidden = false
        }
      )

    })
}

function handleUserQuery(userQuery, userQueryHTML) {
  let contentMessage = userQuery
  console.log('handleUserQuery', contentMessage)

  let chatMessage = {
    role: 'user',
    content: contentMessage
  }

  messages.push(chatMessage)
  addToConversationHistory(contentMessage, 'dark')
  if (isSpeaking) {
    stopSpeaking()
  }
  console.log('messages', messages)
  let body = JSON.stringify({
    messages: messages
  })
  console.log('body', body)
  let assistantReply = ''
  let toolContent = ''
  let spokenSentence = ''
  let displaySentence = ''

  fetch("/api/get-oai-response", {
    method: "POST",
    body: body
  })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Chat API response status: ${response.status} ${response.statusText}`)
      }
      // if (response.body === null) {
      //   response.body = ''
      // }
      // console.log('response', response)

      const reader = response.body.getReader()
      // const reader = response.choices[0].message.content.getReader()

      // Function to recursively read chunks from the stream
      function read(previousChunkString = '') {
        return reader.read().then(({ value, done }) => {
          // Check if there is still data to read
          if (done) {
            // Stream complete
            return
          }

          // Process the chunk of data (value)
          let chunkString = new TextDecoder().decode(value, { stream: true })
          if (previousChunkString !== '') {
            // Concatenate the previous chunk string in case it is incomplete
            chunkString = previousChunkString + chunkString
          }

          new TextDecoder().decode(value, { stream: true, json: true})
          console.log('unfiltered chunkString', chunkString)

          // Filter out null or empty chunks
          if (chunkString.trim() === "null" || chunkString.trim() === "") {
            console.log("Skipping null or empty chunk.");
            return read(); // Skip this chunk and continue reading
          }
          chunkString = chunkString.replace(/(null)+/g, "");

          try {
            // responseToken = chunkString
            // console.log('responseToken', responseToken)
            
            // if (responseToken !== undefined && responseToken !== null) {
            if (chunkString !== null  || chunkString !== "null") {
              responseToken = chunkString
              if (responseToken !== undefined){
                console.log('responseToken', responseToken)
                try {
                  const isObject = (x) => typeof x === 'object' && !Array.isArray(x) && x !== null
                  console.log(responseToken, typeof responseToken)
                  if (responseToken && responseToken.trim() !== "null") {
                    // Split the chunk by '}' once
                    const parts = chunkString.split('}', 1) // Split only once
                    console.log('part 0:', parts[0])
                    const jsonPart = parts[0] + '}' // Add back the trailing '}'
                    // product = JSON.parse(responseToken);
                    const remaining_text = chunkString.slice(
                      jsonPart.length
                    ); // Get the remaining text
                    // const remaining_text = parts[1]
                    console.log('remaining_text:', remaining_text)
                    product = JSON.parse(jsonPart)
                    // console.log('product name:', product.product_name)
                    console.log(product, isObject(product), typeof product)
                    product.image_url = decodeURIComponent(product.image_url)
                    // product.image_url.replace(/%25/g, '%');
                    console.log(product.image_url);
                    if (product && product.image_url && isObject(product)) {
                      addProductToUI(product)
                      console.log('product added to UI:', product)
                      responseToken = remaining_text
                      // displaySentence = remaining_text
                      console.log('responseToken:', responseToken)
                    // fetch('/api/get-product-info', {
                    //   method: 'POST',
                    //   headers: {
                    //     'Content-Type': 'application/json',
                    //   },
                    //   body: JSON.stringify({
                    //     product_name: product.name, // Pass the product name or other details
                    //     product_id: product.id,     // Include the product ID if available
                    //   }),
                    // })
                    //   .then(response => response.json())
                    //   .then(productInfo => {
                    //     addProductToUI(productInfo);
                    //   })
                    //   .catch(error => {
                    //     console.error('Error fetching product info:', error);
                    //   })
                    }
                  }
                } catch (error) {
                  console.log('Error parsing product:', error)
                }
                // }
                assistantReply += responseToken // build up the assistant message
                displaySentence += responseToken // build up the display sentence
                if (responseToken === '\n' || responseToken === '\n\n') {
                  speak(spokenSentence.trim())
                  spokenSentence = ''
                } else {
                  responseToken = responseToken.replace(/\n/g, '')
                  responseToken = responseToken.replace(/[*\uD83C-\uDBFF\uDC00-\uDFFF]+/g, '');
                  spokenSentence += responseToken // build up the spoken sentence

                  if (responseToken.length === 1 || responseToken.length === 2) {
                    for (let i = 0; i < sentenceLevelPunctuations.length; ++i) {
                      let sentenceLevelPunctuation = sentenceLevelPunctuations[i]
                      if (responseToken.startsWith(sentenceLevelPunctuation)) {
                        speak(spokenSentence.trim())
                        spokenSentence = ''
                        break
                      }
                    }
                  }
                }
              }
            }
          } catch (error) {
            console.log(`Error occurred while parsing the response: ${error}`)
            console.log(chunkString)
          }
          // })

          if (displaySentence !== '') {
            console.log('displaySentence', displaySentence)
            addToConversationHistory(displaySentence, 'light');
          }
          displaySentence = ''
          return read()
        })
      }

      // Start reading the stream
      return read()
    })
    .then(() => {
      if (spokenSentence !== '') {
        speak(spokenSentence.trim())
        spokenSentence = ''
      }
      let assistantMessage = {
        role: 'assistant',
        content: assistantReply
      }

      messages.push(assistantMessage)
    })
}

// Speak the given text
function speak(text, endingSilenceMs = 0) {
  if (isSpeaking) {
    spokenTextQueue.push(text)
    return
  }

  speakNext(text, endingSilenceMs)
}

function speakNext(text, endingSilenceMs = 0) {
  let ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${TTSVoice}'><mstts:leadingsilence-exact value='0'/>${text}</voice></speak>`
  if (endingSilenceMs > 0) {
    ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${TTSVoice}'><mstts:leadingsilence-exact value='0'/>${text}<break time='${endingSilenceMs}ms' /></voice></speak>`
  }

  lastSpeakTime = new Date()
  isSpeaking = true
  avatarSynthesizer.speakSsmlAsync(ssml).then(
    (result) => {
      if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
        console.log(`Speech synthesized to speaker for text [ ${text} ]. Result ID: ${result.resultId}`)

        lastSpeakTime = new Date()
      } else {
        console.log(`Error occurred while speaking the SSML. Result ID: ${result.resultId}`)
      }

      if (spokenTextQueue.length > 0) {
        speakNext(spokenTextQueue.shift())
      } else {
        isSpeaking = false
      }
    }).catch(
      (error) => {
        console.log(`Error occurred while speaking the SSML: [ ${error} ]`)

        if (spokenTextQueue.length > 0) {
          speakNext(spokenTextQueue.shift())
        } else {
          isSpeaking = false
        }
      }
    )
}

function stopSpeaking() {
  spokenTextQueue = []
  avatarSynthesizer.stopSpeakingAsync().then(
    () => {
      isSpeaking = false
      console.log("[" + (new Date()).toISOString() + "] Stop speaking request sent.")
    }
  ).catch(
    (error) => {
      console.log("Error occurred while stopping speaking: " + error)
    }
  )
}


// Connect to TTS Avatar API
function connectToAvatarService() {
  // Construct TTS Avatar service request
  let videoCropTopLeftX = 600
  let videoCropBottomRightX = 1320
  let backgroundColor = '#00FF00FF'

  const videoFormat = new SpeechSDK.AvatarVideoFormat()
  videoFormat.setCropRange(new SpeechSDK.Coordinate(videoCropTopLeftX, 0), new SpeechSDK.Coordinate(videoCropBottomRightX, 1080));
  const avatarName = document.getElementById("avatar-name").value;
  console.log("Selected Avatar Name:", avatarName);
  TalkingAvatarCharacter = avatarName
  // switch(TalkingAvatarCharacter) {
  //   // case "Lisa":
  //   //   TalkingAvatarStyle = "casual-sitting"
  //   //   break
  //   // case "Meg":
  //   //   TalkingAvatarStyle = "casual"
  //   //   break
  //   // case "Mark":
  //   // TalkingAvatarStyle = "formal"
  //   //   break
     
  // }

  const avatarConfig = new SpeechSDK.AvatarConfig(TalkingAvatarCharacter, TalkingAvatarStyle, videoFormat)
  avatarConfig.backgroundColor = backgroundColor

  avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechSynthesisConfig, avatarConfig)
  avatarSynthesizer.avatarEventReceived = function (s, e) {
    var offsetMessage = ", offset from session start: " + e.offset / 10000 + "ms."
    if (e.offset === 0) {
      offsetMessage = ""
    }
    console.log("Event received: " + e.description + offsetMessage)
  }

}

window.startSession = () => {
  var iconElement = document.createElement("i");
  iconElement.className = "fa fa-spinner fa-spin";
  iconElement.id = "loadingIcon"
  var parentElement = document.getElementById("playVideo");
  parentElement.prepend(iconElement);

  TTSVoice = document.getElementById("avatar-voice").value

  try {
    speechSynthesisConfig = initializeSpeechSynthesisConfigSync();
    console.log("Speech synthesis configuration is ready to use.");
    // Use the `speechSynthesisConfig` object as needed
  } catch (error) {
    console.error("Initialization failed:", error.message);
    alert("Failed to initialize speech synthesis configuration. Please check your network or Azure configuration.");
  }

  speechSynthesisConfig.speechSynthesisVoiceName = TTSVoice
  document.getElementById('playVideo').className = "round-button-hide"

  // const avatarName = document.getElementById("avatar-name").value;
  // console.log("Selected Avatar Name:", avatarName);
  const avatarVoice = document.getElementById("avatar-voice").value;
  console.log("Selected Avatar Voice:", avatarVoice);

  TTSVoice = avatarVoice;

  //   // Call the function to initialize the configuration
  // initializeSpeechSynthesisConfig()
  // .then(config => {
  //   console.log("Speech synthesis configuration is ready to use.");
  //   // Use the `config` object as needed
  //   speechSynthesisConfig = config; // Assign the returned config to a global or local variable
  // })
  // .catch(error => {
  //   console.error("Initialization failed:", error.message);
  //   alert("Failed to initialize speech synthesis configuration. Please check your network or Azure configuration.");
  // });

  speechSynthesisConfig.speechSynthesisVoiceName = TTSVoice
  document.getElementById("playVideo").className = "round-button-hide"

  fetch("/api/get-speech-token", {
    method: "POST",
  })
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(`Failed to fetch speech token: ${res.status} ${res.statusText}`);
      }
      const responseJson = await res.json();
      speechSynthesisConfig.authorizationToken = responseJson.token;
      token = responseJson.token;
    })
    .then(() => {
      speechSynthesizer = new SpeechSDK.SpeechSynthesizer(speechSynthesisConfig, null);
      connectToAvatarService();
      setupWebRTC();
    })
    .catch((error) => {
      console.error("Error fetching speech token:", error);
      alert("Failed to start session. Please try again.");
      document.getElementById("playVideo").className = "round-button";
      document.getElementById("loadingIcon").remove();
    });
};

async function greeting() {
  text = `Hi, my name is ${TalkingAvatarCharacter}. How can I help you?`;
  addToConversationHistory(text, "light")

  var spokenText = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${TTSVoice}'><mstts:leadingsilence-exact value='0'/>${text}</voice></speak>`

  console.log('spokenText', spokenText)
  avatarSynthesizer.speakSsmlAsync(spokenText, (result) => {
    if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
      console.log("Speech synthesized to speaker for text [ " + spokenText + " ]. Result ID: " + result.resultId)
    } else {
      console.log("Unable to speak text. Result ID: " + result.resultId)
      if (result.reason === SpeechSDK.ResultReason.Canceled) {
        let cancellationDetails = SpeechSDK.CancellationDetails.fromResult(result)
        console.log(cancellationDetails.reason)
        if (cancellationDetails.reason === SpeechSDK.CancellationReason.Error) {
          console.log(cancellationDetails.errorDetails)
        }
      }
    }
  })
}

window.stopSession = () => {
  speechSynthesizer.close()
}

let isRecording = false;

function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

function startRecording() {
  const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, CogSvcRegion);
  speechConfig.authorizationToken = token;
  speechConfig.SpeechServiceConnection_LanguageIdMode = "Continuous";
  const autoDetectSourceLanguageConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(supported_languages);

  document.getElementById('buttonIcon').className = "fas fa-stop";
  document.getElementById('startRecording').disabled = false;

  recognizer = SpeechSDK.SpeechRecognizer.FromConfig(speechConfig, autoDetectSourceLanguageConfig);

  recognizer.recognized = function (s, e) {
    if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
      const userQuery = e.result.text.trim();
      if (userQuery === '') {
        return;
      }
      console.log('Recognized:', e.result.text);
      if (!continuousRecording) {
        stopRecording();
      }

      handleUserQuery(e.result.text, "", "");
    }
  };

  recognizer.startContinuousRecognitionAsync();
  isRecording = true;
  console.log('Recording started.');
}

function stopRecording() {
  if (recognizer) {
    recognizer.stopContinuousRecognitionAsync(
      function () {
        recognizer.close();
        recognizer = undefined;
        document.getElementById('buttonIcon').className = "fas fa-microphone";
        document.getElementById('startRecording').disabled = false;
        isRecording = false;
        console.log('Recording stopped.');
      },
      function (err) {
        console.error('Error stopping recording:', err);
      }
    );
  }
}

window.submitText = () => {
  document.getElementById('spokenText').textContent = document.getElementById('textinput').currentValue
  document.getElementById('textinput').currentValue = ""
  window.speak(document.getElementById('textinput').currentValue);
}

function addToConversationHistory(item, historytype) {
  const list = document.getElementById('chathistory');
  // if (list.children.length !== 0) {
  //   const lastItem = list.lastChild;
  //   console.log('List:', list);
  //   console.log('Last item:', lastItem);
  //   if (lastItem.classList.contains(`message--${historytype}`)) {
  //     lastItem.textContent += `${item}`;
  //     return;
  //   }
    if (list.children.length !== 0) {
      const lastItem = list.children[list.children.length - 1]; // Get the last child element
      console.log('Last item:', lastItem);
      if (lastItem.classList.contains(`message--${historytype}`)) {
        lastItem.textContent += `${item}`;
        return;
      } else {
        lastItem.textContent += `\n`;
      }
    }
  const newItem = document.createElement('li');
  newItem.classList.add('message');
  newItem.classList.add(`message--${historytype}`);
  newItem.textContent = item;
  list.appendChild(newItem);
}

function addProductToUI(productInfo) {
  productInfo.image_url.replace(/%25/g, '%');
  console.log('addProductToUI', productInfo)
  const productCardHTML = `
    <div class="product-card">
      <img src="${productInfo.image_url}" alt="Product Image" class="product-card__image" />
      <div class="product-card__content">
        <h2 class="product-card__title">${productInfo.product_name}</h2>
        <h3 class="product-card__tagline">${productInfo.tagline}</h3>
        <p class="product-card__points">
          <span class="product-card__old-points">Original Points: ${productInfo.original_points}</span>
          <span class="product-card__special-offer">Special Offer: ${productInfo.special_offer}</span>
        </p>
      </div>
    </div>
  `;

  // Append the product card to the chat history or a specific container
  const chatHistory = document.getElementById('chathistory'); // Replace with your container ID
  chatHistory.innerHTML += productCardHTML;

  // Scroll to the bottom of the chat history
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

// Make video background transparent by matting
function makeBackgroundTransparent(timestamp) {
  // Throttle the frame rate to 30 FPS to reduce CPU usage
  if (timestamp - previousAnimationFrameTimestamp > 30) {
    video = document.getElementById('video')
    tmpCanvas = document.getElementById('tmpCanvas')
    tmpCanvasContext = tmpCanvas.getContext('2d', { willReadFrequently: true })
    tmpCanvasContext.drawImage(video, 0, 0, video.videoWidth, video.videoHeight)
    if (video.videoWidth > 0) {
      let frame = tmpCanvasContext.getImageData(0, 0, video.videoWidth, video.videoHeight)
      for (let i = 0; i < frame.data.length / 4; i++) {
        let r = frame.data[i * 4 + 0]
        let g = frame.data[i * 4 + 1]
        let b = frame.data[i * 4 + 2]

        if (g - 150 > r + b) {
          // Set alpha to 0 for pixels that are close to green
          frame.data[i * 4 + 3] = 0
        } else if (g + g > r + b) {
          // Reduce green part of the green pixels to avoid green edge issue
          adjustment = (g - (r + b) / 2) / 3
          r += adjustment
          g -= adjustment * 2
          b += adjustment
          frame.data[i * 4 + 0] = r
          frame.data[i * 4 + 1] = g
          frame.data[i * 4 + 2] = b
          // Reduce alpha part for green pixels to make the edge smoother
          a = Math.max(0, 255 - adjustment * 4)
          frame.data[i * 4 + 3] = a
        }
      }

      canvas = document.getElementById('canvas')
      canvasContext = canvas.getContext('2d')
      canvasContext.putImageData(frame, 0, 0);
    }

    previousAnimationFrameTimestamp = timestamp
  }

  window.requestAnimationFrame(makeBackgroundTransparent)
}
