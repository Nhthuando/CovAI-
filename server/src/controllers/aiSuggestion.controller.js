import { aiSuggestionService } from '../services/aiSuggestion.service.js';

export const createSuggestion = async (req, res) => {
  try {
    const suggestion = await aiSuggestionService.createSuggestion(req.body);
    res.status(201).json(suggestion);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
