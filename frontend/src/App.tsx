import React from 'react';
import { CustomerApp } from './components/CustomerApp';
import { BusinessApp } from './components/BusinessApp';

export const App: React.FC = () => {
  // Check port or URL query parameters
  // Port 5174 = Business Side (Agent Inbox & Admin Portal)
  // Port 5173 = Customer Side (Public Website & Visitor Chat)
  const isBusinessPort = window.location.port === '5174';
  const urlParams = new URLSearchParams(window.location.search);
  const portalParam = urlParams.get('portal');

  const isBusiness = portalParam === 'business' || (portalParam !== 'customer' && isBusinessPort);

  React.useEffect(() => {
    document.body.className = isBusiness ? 'business-portal' : 'customer-portal';
  }, [isBusiness]);

  return isBusiness ? <BusinessApp /> : <CustomerApp />;
};

export default App;
