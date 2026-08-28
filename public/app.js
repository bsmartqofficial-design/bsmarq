const socket = window.io ? io({ query: window.organizationId ? { organizationId: window.organizationId } : {} }) : null;
const currentTicket = document.getElementById('currentTicket');
const waitingCount = document.getElementById('waitingCount');
const callNext = document.getElementById('callNext');
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menuToggle');
const searchToggle = document.getElementById('searchToggle');
const notificationToggle = document.getElementById('notificationToggle');
const branchSelect = document.getElementById('branchSelect');
const aiChatForm = document.getElementById('aiChatForm');
const aiMessage = document.getElementById('aiMessage');
const aiChatMessages = document.getElementById('aiChatMessages');

document.querySelectorAll('.wait-bar i[data-width]').forEach((bar) => {
  bar.style.width = `${bar.dataset.width}%`;
});

function updateQueue(queue) {
  const waiting = queue.filter((ticket) => ticket.status === 'Waiting').length;
  const serving = queue.find((ticket) => ticket.status === 'Now serving');
  if (waitingCount) waitingCount.textContent = waiting;
  if (serving && currentTicket) currentTicket.textContent = serving.number;
  if (window.trackedTicket) {
    const tracked = queue.find((ticket) => ticket.number === window.trackedTicket);
    const status = document.getElementById('ticketStatus');
    if (tracked && status) status.textContent = tracked.status;
  }
  const liveTickets = document.getElementById('liveTickets');
  if (liveTickets) {
    liveTickets.replaceChildren(...queue.map((ticket) => {
      const row = document.createElement('div');
      row.className = 'live-ticket-row';
      const fields = [ticket.number, ticket.service, ticket.customer, ticket.status, ticket.counter, ticket.waited];
      fields.forEach((value, index) => {
        const element = document.createElement(index === 0 ? 'strong' : index === 5 ? 'small' : 'span');
        element.textContent = value;
        if (index === 3) element.className = `ticket-status ${ticket.status.toLowerCase().replaceAll(' ', '-')}`;
        row.appendChild(element);
      });
      return row;
    }));
  }
  if (document.body.classList.contains('display-page')) {
    const displayNumber = document.querySelector('.display-number');
    const displayCounter = document.querySelector('.display-counter');
    if (serving && displayNumber) displayNumber.textContent = serving.number;
    if (serving && displayCounter) displayCounter.textContent = serving.counter;
  }
}
if (socket) socket.on('queue:update', updateQueue);
if (callNext) callNext.addEventListener('click', async () => {
  callNext.disabled = true;
  callNext.textContent = 'Calling next...';
  const response = await fetch('/api/tickets/next', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ counter: callNext.dataset.counter || 'Counter 04' }) });
  const ticket = await response.json();
  if (ticket.number && currentTicket) currentTicket.textContent = ticket.number;
  callNext.disabled = false;
  callNext.innerHTML = '⌁ &nbsp; Call next customer';
});
if (menuToggle) menuToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
if (searchToggle) searchToggle.addEventListener('click', () => searchToggle.classList.toggle('active'));
if (branchSelect) branchSelect.addEventListener('click', () => branchSelect.classList.toggle('active'));
if (notificationToggle) notificationToggle.addEventListener('click', () => notificationToggle.classList.toggle('active'));
document.querySelectorAll('.more, .panel-head .icon-btn').forEach((button) => {
  if (button !== menuToggle && button !== notificationToggle) button.addEventListener('click', () => button.classList.toggle('active'));
});
if (notificationToggle) notificationToggle.addEventListener('click', () => {
  notificationToggle.classList.toggle('active');
  notificationToggle.title = notificationToggle.classList.contains('active') ? 'Notifications viewed' : 'Notifications';
});
if (aiChatForm) aiChatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = aiMessage.value.trim();
  if (!message) return;
  const userMessage = document.createElement('div');
  userMessage.className = 'ai-message user';
  userMessage.textContent = message;
  aiChatMessages.appendChild(userMessage);
  aiMessage.value = '';
  const pending = document.createElement('div');
  pending.className = 'ai-message assistant';
  pending.textContent = 'Thinking...';
  aiChatMessages.appendChild(pending);
  aiChatForm.querySelector('button').disabled = true;
  try {
    const response = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
    const data = await response.json();
    pending.textContent = data.answer || data.error || 'BsmartQ AI could not answer right now.';
  } catch (error) { pending.textContent = 'BsmartQ AI is unavailable right now.'; }
  aiChatForm.querySelector('button').disabled = false;
  aiMessage.focus();
  aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
});
