// Isolated browser-test entry. It is not included in the application build.
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TrustworthinessWorkspace from '../src/components/dashboard/trustworthiness/TrustworthinessWorkspace';
import ProjectChatbotWorkspace from '../src/components/dashboard/trustworthiness/ProjectChatbotWorkspace';
import '../src/index.css';
const projectId = new URLSearchParams(location.search).get('projectId');
const Workspace = new URLSearchParams(location.search).get('mode') === 'project' ? ProjectChatbotWorkspace : TrustworthinessWorkspace;
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><BrowserRouter><Workspace projectId={projectId} /></BrowserRouter></QueryClientProvider>);
