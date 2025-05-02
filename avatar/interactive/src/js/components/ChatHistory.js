class ChatHistory extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        .chat-history {
            max-height: 50%;
            overflow-y: auto;
            padding: 10px;
            border-radius: 8px;
        }

        .messages-container {
            display: flex;
            flex-direction: column;
        }

        .message {
            margin: 10px 0;
            padding: 10px;
            border-radius: 8px;
            font-size: 14px;
            line-height: 1.5;
        }

        .message--light {
            background-color: #d8d8d8;
        }

        .message--dark {
            background-color: black;
            color: white;
        }
      </style>
      <div class="chat-history" id="chat-history"></div>
    `;
  }

// connectedCallback() {
// this.shadowRoot.innerHTML = `
//     <style>
//     .chat-history {
//         max-height: 400px;
//         overflow-y: auto;
//         border: 1px solid #ccc;
//         padding: 10px;
//         border-radius: 8px;
//         background-color: #f9f9f9;
//     }
//     </style>
//     <div class="chat-history" id="chat-history"></div>
// `;
// }

  addMessage(content, type) {
    const chatHistory = this.shadowRoot.getElementById('chat-history');
    const message = document.createElement('div');
    message.className = `message message--${type}`;
    message.textContent = content;
    chatHistory.appendChild(message);
    this.scrollToBottom();
  }

  addProduct(productInfo) {
    const chatHistory = this.shadowRoot.getElementById('chat-history');
    const productCard = document.createElement('product-card');
    productCard.setAttribute('data-product-info', JSON.stringify(productInfo));
    chatHistory.appendChild(productCard);
    this.scrollToBottom();
  }

  scrollToBottom() {
    const chatHistory = this.shadowRoot.getElementById('chat-history');
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }
}

// Define the custom element
customElements.define('chat-history', ChatHistory);