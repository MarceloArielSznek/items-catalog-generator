attic-projects-catalog-composer/
├── client/
│   ├── public/
│   └── src/
│       ├── assets/
│       ├── components/
│       │   ├── UploadField.jsx
│       │   ├── ImagePreviewCard.jsx
│       │   ├── GenerateButton.jsx
│       │   ├── ResultPanel.jsx
│       │   └── Header.jsx
│       ├── pages/
│       │   └── HomePage.jsx
│       ├── services/
│       │   └── api.js
│       ├── hooks/
│       │   └── useCatalogComposer.js
│       ├── utils/
│       │   └── fileHelpers.js
│       ├── styles/
│       │   └── app.css
│       ├── App.jsx
│       ├── main.jsx
│       └── config.js
│
├── server/
│   ├── src/
│   │   ├── routes/
│   │   │   └── imageRoutes.js
│   │   ├── controllers/
│   │   │   └── imageController.js
│   │   ├── services/
│   │   │   ├── openaiImageService.js
│   │   │   ├── compositionService.js
│   │   │   └── storageService.js
│   │   ├── middleware/
│   │   │   ├── uploadMiddleware.js
│   │   │   ├── errorHandler.js
│   │   │   └── validateGenerateRequest.js
│   │   ├── utils/
│   │   │   ├── ensureDir.js
│   │   │   ├── logger.js
│   │   │   ├── fileValidation.js
│   │   │   └── promptBuilder.js
│   │   ├── config/
│   │   │   └── env.js
│   │   ├── uploads/
│   │   ├── generated/
│   │   ├── app.js
│   │   └── server.js
│   ├── .env.example
│   └── package.json
│
├── shared/
│   └── constants/
│       └── imageRules.js
│
├── context.md
├── system-prompt.md
├── README.md
└── package.json