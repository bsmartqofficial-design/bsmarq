const demo = {
  organization: { name: 'ABC Bank', type: 'Banking & Finance', branch: 'Kampala Main Branch' },
  services: [
    { name: 'Cash Deposit', prefix: 'DEP', wait: '18 min', count: 12, color: 'green' },
    { name: 'Account Opening', prefix: 'ACC', wait: '26 min', count: 8, color: 'blue' },
    { name: 'Loan Consultation', prefix: 'LOA', wait: '34 min', count: 6, color: 'orange' },
    { name: 'Card Services', prefix: 'CRD', wait: '11 min', count: 4, color: 'purple' }
  ],
  tickets: [
    { number: 'DEP-023', customer: 'Sarah Namirembe', service: 'Cash Deposit', status: 'Now serving', counter: 'Counter 04', waited: '14 min' },
    { number: 'DEP-024', customer: 'Michael Okello', service: 'Cash Deposit', status: 'Waiting', counter: '—', waited: '08 min' },
    { number: 'ACC-009', customer: 'Grace Achieng', service: 'Account Opening', status: 'Waiting', counter: '—', waited: '05 min' },
    { number: 'LOA-006', customer: 'David Kato', service: 'Loan Consultation', status: 'Waiting', counter: '—', waited: '03 min' }
  ],
  stats: { waiting: 30, serving: 8, completed: 124, avgWait: '16m 42s' }
};
module.exports = demo;
