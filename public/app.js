if (typeof window !== 'undefined' && typeof document !== 'undefined') {
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
  const dashboardSearch = document.getElementById('dashboardSearch');
  const searchWrap = document.getElementById('searchWrap');
  const notificationPanel = document.getElementById('notificationPanel');
  const bookingForm = document.getElementById('bookingForm');
  const bookingLinkForm = document.getElementById('bookingLinkForm');

  function updateGreeting() {
    const greetingTarget = document.querySelector('.intro h1');
    if (!greetingTarget) return;
    const hour = new Date().getHours();
    const label = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const name = greetingTarget.dataset.userName || 'Team';
    greetingTarget.innerHTML = `${label}, ${name} <span>✦</span>`;
  }

  function formatAnnouncementNumber(value) {
    return String(value || '').replace(/^[A-Z]+-?/i, '').replace(/[^0-9]/g, '').padStart(3, '0');
  }

  function announceTicket(ticketNumber, counterName = '') {
    if (!ticketNumber || !('speechSynthesis' in window)) return;
    const counterText = counterName ? ` at ${counterName}` : '';
    const text = `Ticket no ${formatAnnouncementNumber(ticketNumber)}${counterText}`;
    const speak = (value) => {
      const utterance = new SpeechSynthesisUtterance(value);
      utterance.lang = 'en-US';
      utterance.rate = 0.95;
      utterance.pitch = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    };
    speak(text);
    setTimeout(() => speak(text), 400);
  }

  function filterDashboardSearch() {
    if (!dashboardSearch) return;
    const term = dashboardSearch.value.trim().toLowerCase();
    const rows = document.querySelectorAll('.live-ticket-row, .service-row');
    rows.forEach((row) => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(term) || !term ? '' : 'none';
    });
    const noResult = document.getElementById('searchNoResult');
    if (noResult) noResult.remove();
    if (term && [...rows].every((row) => row.style.display === 'none')) {
      const empty = document.createElement('div');
      empty.id = 'searchNoResult';
      empty.className = 'empty-ticket-list';
      empty.textContent = 'No matching records found';
      const target = document.getElementById('liveTickets') || document.querySelector('.service-list');
      if (target) target.appendChild(empty);
    }
  }

  document.querySelectorAll('.wait-bar i[data-width]').forEach((bar) => {
    bar.style.width = `${bar.dataset.width}%`;
  });

  function updateQueue(queue) {
    const waiting = queue.filter((ticket) => ticket.status === 'Waiting').length;
    const serving = queue.find((ticket) => ticket.status.includes('Serving') || ticket.status.includes('serving'));
    if (waitingCount) waitingCount.textContent = waiting;
    if (serving && currentTicket) currentTicket.textContent = serving.number;
    if (serving && window.lastServingTicket !== serving.number) {
      announceTicket(serving.number, serving.counter || serving.counter_name || 'Counter 1');
      window.lastServingTicket = serving.number;
    }
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
    if (ticket.number) announceTicket(ticket.number, ticket.counter_name || ticket.counter || callNext.dataset.counter || 'Counter 1');
    callNext.disabled = false;
    callNext.innerHTML = '⌁ &nbsp; Call next customer';
  });
  updateGreeting();
  if (menuToggle) menuToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
  if (searchToggle) searchToggle.addEventListener('click', () => {
    searchToggle.classList.toggle('active');
    if (searchWrap) searchWrap.classList.toggle('hidden');
    if (!searchWrap.classList.contains('hidden') && dashboardSearch) dashboardSearch.focus();
  });
  if (bookingLinkForm) {
    bookingLinkForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(bookingLinkForm);
      const purpose = String(formData.get('purpose') || '').trim() || 'Service support';
      const baseUrl = `${window.location.origin}/join?organizationId=${encodeURIComponent(window.organizationId || '')}`;
      const generatedUrl = `${baseUrl}&purpose=${encodeURIComponent(purpose)}`;
      const output = document.getElementById('bookingLinkOutput');
      if (output) {
        output.innerHTML = `
          <label>
            <span>Client booking link</span>
            <input type="text" value="${generatedUrl}" readonly />
          </label>
          <button type="button" class="button secondary" data-copy-link="${generatedUrl}">Copy link</button>
        `;
        const copyButton = output.querySelector('[data-copy-link]');
        if (copyButton) {
          copyButton.addEventListener('click', async () => {
            await navigator.clipboard.writeText(copyButton.dataset.copyLink);
            copyButton.textContent = 'Link copied';
          });
        }
      }
    });
  }

  if (bookingForm) {
    bookingForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(bookingForm);
      const title = String(formData.get('title') || '').trim() || 'Booking available';
      const message = String(formData.get('message') || '').trim();
      if (!message) return;
      const response = await fetch('/api/home-booking-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, message })
      });
      const data = await response.json();
      if (data.success) {
        bookingForm.reset();
        const statusMessage = document.getElementById('bookingStatus');
        if (statusMessage) statusMessage.textContent = 'Booking update sent successfully.';
      }
    });
  }
  if (dashboardSearch) dashboardSearch.addEventListener('input', filterDashboardSearch);
  if (branchSelect) branchSelect.addEventListener('click', () => branchSelect.classList.toggle('active'));
  if (notificationToggle) notificationToggle.addEventListener('click', () => {
    notificationToggle.classList.toggle('active');
    if (notificationPanel) notificationPanel.classList.toggle('hidden');
    notificationToggle.title = notificationToggle.classList.contains('active') ? 'Notifications viewed' : 'Notifications';
    if (notificationPanel && !notificationPanel.classList.contains('hidden')) {
      fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' } }).catch(() => undefined);
    }
  });
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
}
