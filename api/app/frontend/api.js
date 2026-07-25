// API integration for JaiKrajok backend
const API_BASE = window.location.origin;

// Generate random user ID for web chat (in production, use proper auth)
let userId = localStorage.getItem('jaikrajok_user_id');
if (!userId) {
  userId = 'web_' + Math.random().toString(36).substring(2, 15);
  localStorage.setItem('jaikrajok_user_id', userId);
}

// Replace the detectEmotion function to call real API
async function detectEmotionAPI(text) {
  try {
    const response = await fetch(`${API_BASE}/api/emotion/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    
    if (!response.ok) throw new Error('Emotion API failed');
    
    const data = await response.json();
    // Map API emotion labels to frontend emotion keys
    return mapEmotionLabel(data.emotion);
  } catch (error) {
    console.error('Emotion detection failed:', error);
    // Fallback to client-side detection
    return detectEmotion(text);
  }
}

function mapEmotionLabel(apiLabel) {
  // Map AI for Thai sentiment labels to frontend emotion keys
  const labelMap = {
    'neg': 'stressed',
    'negative': 'stressed',
    'pos': 'calm',
    'positive': 'calm',
    'neu': 'neutral',
    'neutral': 'neutral'
  };
  return labelMap[apiLabel.toLowerCase()] || 'neutral';
}

// Replace respondTo to call real Pathumma API
async function respondToAPI(userMessage, sourceLabel) {
  noteMultimodal(sourceLabel);
  showTyping(TRANSPARENCY[sourceLabel] || 'กำลังวิเคราะห์ข้อมูลด้วย Pathumma LLM');
  
  try {
    const response = await fetch(`${API_BASE}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        user_id: userId,
        message: userMessage 
      })
    });
    
    if (!response.ok) throw new Error('Chat API failed');
    
    const data = await response.json();
    hideTyping();
    
    // Show bot reply
    appendBubble('bot', data.reply);
    
    // Update avatar mood based on detected emotion
    const emotionKey = data.emotion ? mapEmotionLabel(data.emotion) : 'calm';
    setAvatarMood(emotionKey);
    pushTrend(emotionKey, sourceLabel);
    
  } catch (error) {
    console.error('Chat API failed:', error);
    hideTyping();
    // Fallback to original client-side logic
    const key = detectEmotion(userMessage);
    const list = RESPONSES[key];
    const msg = list[Math.floor(Math.random()*list.length)];
    appendBubble('bot', msg);
    setAvatarMood(key);
    pushTrend(key, sourceLabel);
  }
}

// Override sendText to use API
window.sendTextOriginal = window.sendText;
window.sendText = function() {
  const input = document.getElementById('textInput');
  const val = input.value.trim();
  if(!val) return;
  appendBubble('user', escapeHtml(val));
  const userMessage = val;
  input.value = '';
  respondToAPI(userMessage, 'ข้อความ');
};
