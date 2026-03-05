/**
 * /upload — DISABLED for web
 * File uploads are CLI-only: node cli/know.js upload <file>
 */
const express = require('express');
const router  = express.Router();

router.post('/', (req, res) => {
  res.status(403).json({
    error: 'Web upload disabled. Use Termux CLI:',
    command: 'node cli/know.js upload <file_or_folder>',
    examples: [
      'node cli/know.js upload ~/notes.pdf',
      'node cli/know.js upload ~/Documents/ --recursive',
      'node cli/know.js upload ~/code/ --category=tech --recursive',
    ],
  });
});

module.exports = router;
