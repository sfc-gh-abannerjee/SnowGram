import { ReactFlowProvider } from 'reactflow';
import App from '../src/App';

export default function Home() {
  return (
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>
  );
}
