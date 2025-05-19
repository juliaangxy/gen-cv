class ProductCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }); // Use Shadow DOM for encapsulation
  }

  connectedCallback() {
    const productInfo = JSON.parse(this.getAttribute('data-product-info'));
    // const imageUrl = productInfo.image_url;
    const decodedImageUrl = decodeURIComponent(productInfo.image_url.replace(/%25/g, '%').replace(/=(?=[^=]*$)/, '%3D'));

    this.shadowRoot.innerHTML = `
      <style>
        .product-card {
          display: flex;
          flex-direction: column;
          border: 1px solid #ccc;
          border-radius: 8px;
          padding: 10px;
          margin: 10px 0;
          background-color: #fff;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          max-width: 300px;
        }
        .product-card__image {
          width: 100%;
          height: auto;
          border-radius: 8px;
        }
        .product-card__content {
          margin-top: 10px;
        }
        .product-card__tagline {
          font-size: 14px;
          font-weight: bold;
          margin: 0;
          word-wrap: break-word;
          overflow-wrap: break-word;
          white-space: normal;
        }
        .product-card__points {
          margin-top: 8px;
          font-size: 12px;
          line-height: 1.5;
        }
        .product-card__old-points {
          text-decoration: line-through;
          color: #888;
        }
        .product-card__special-offer {
          font-weight: bold;
          color: #28a745;
          margin-left: 5px;
        }
      </style>
      <div class="product-card">
        <img src="${decodedImageUrl}" alt="Product Image" class="product-card__image" />
        <div class="product-card__content">
          <h3 class="product-card__tagline">${productInfo.tagline}</h3>
          <p class="product-card__points">
            <span class="product-card__old-points">Original Points: ${productInfo.original_points}</span>
            <span class="product-card__special-offer">Special Offer: ${productInfo.special_offer}</span>
          </p>
        </div>
      </div>
    `;
  }
}

// Define the custom element
customElements.define('product-card', ProductCard);