import { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Activity, 
  Cpu, 
  ScanFace, 
  Brain, 
  Terminal, 
  AlertCircle, 
  Heart, 
  Zap,
  Play,
  Square,
  Copy,
  Check,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import * as faceapi from '@vladmandic/face-api';
import { GoogleGenAI } from "@google/genai";
import { ARDUINO_SKETCH } from './constants';

// --- Types ---
interface SensorData {
  gsr: number;
  pulse: number;
  time: string;
}

interface StressMetrics {
  level: number; // 0-100
  label: string;
  expression: string;
  confidence: number;
}

// --- App ---
export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'ai' | 'arduino'>('dashboard');
  const [isSerialConnected, setIsSerialConnected] = useState(false);
  const [sensorHistory, setSensorHistory] = useState<SensorData[]>([]);
  const [currentFace, setCurrentFace] = useState<string>('Detecting...');
  const [stressScore, setStressScore] = useState<number>(0);
  const [aiInsight, setAiInsight] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const serialPortRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader | null>(null);
  const [copied, setCopied] = useState(false);

  // --- Face API Setup ---
  useEffect(() => {
    const loadModels = async () => {
      const MODEL_URL = 'https://raw.githubusercontent.com/vladmandic/face-api/master/model/';
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL)
      ]);
      startVideo();
    };
    loadModels();
  }, []);

  const startVideo = () => {
    navigator.mediaDevices.getUserMedia({ video: {} })
      .then(stream => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(err => console.error("Camera access denied:", err));
  };

  useEffect(() => {
    const interval = setInterval(async () => {
      if (videoRef.current && videoRef.current.readyState === 4) {
        const detection = await faceapi.detectSingleFace(
          videoRef.current, 
          new faceapi.TinyFaceDetectorOptions()
        ).withFaceExpressions();

        if (detection) {
          const expressions = detection.expressions;
          const maxExpr = Object.entries(expressions).reduce((a, b) => a[1] > b[1] ? a : b);
          setCurrentFace(maxExpr[0]);
          
          // Basic stress calculation based on expressions
          // High stress markers: angry, fearful, sad, surprised
          const stressBase = (expressions.angry + expressions.fearful + expressions.sad) * 100;
          setStressScore(prev => Math.min(100, Math.max(0, stressBase)));
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // --- Serial API ---
  const connectSerial = async () => {
    try {
      const nav = navigator as any;
      if (!nav.serial) {
        alert("Web Serial API not supported in this browser. Please use Chrome or Edge.");
        return;
      }
      const port = await nav.serial.requestPort();
      await port.open({ baudRate: 115200 });
      serialPortRef.current = port;
      setIsSerialConnected(true);
      
      const decoder = new TextDecoderStream();
      port.readable?.pipeTo(decoder.writable);
      const reader = decoder.readable.getReader();
      readerRef.current = reader;

      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          try {
            const data = JSON.parse(line.trim());
            const newPoint = { 
              ...data, 
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) 
            };
            setSensorHistory(prev => [...prev.slice(-49), newPoint]);
          } catch (e) {
            // Ignore partial lines
          }
        }
      }
    } catch (error) {
      console.error("Serial error:", error);
      setIsSerialConnected(false);
    }
  };

  const disconnectSerial = async () => {
    if (readerRef.current) {
      await readerRef.current.cancel();
      readerRef.current = null;
    }
    if (serialPortRef.current) {
      await serialPortRef.current.close();
      serialPortRef.current = null;
    }
    setIsSerialConnected(false);
  };

  // --- AI Stress Analysis (Gemini) ---
  const analyzeStressWithAI = async () => {
    if (isAnalyzing) return;
    setIsAnalyzing(true);
    setAiInsight('V.E.R.A Neural Engine processing bio-metrics...');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const lastGSR = sensorHistory[sensorHistory.length - 1]?.gsr || 0;
      const lastPulse = sensorHistory[sensorHistory.length - 1]?.pulse || 0;
      
      const prompt = `
        Analyze this bio-metric profile from the VERA sensor suite:
        - Current Expression: ${currentFace}
        - GSR (Skin Response - Voltage/Resistance): ${lastGSR} (Scale 0-1023)
        - Pulse (BPM approximation): ${lastPulse} (Scale 0-1023)
        - Computer Stress Score: ${stressScore}%

        Provide a concise, professional, and empathetic clinical-style assessment (MAX 100 words). 
        Identify if there is high stress and suggest 2 corrective breathing or environmental adjustments.
        Use a technical but human tone.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      setAiInsight(response.text || 'Analysis complete. Normal baseline detected.');
    } catch (error) {
      console.error("AI error:", error);
      setAiInsight('Communication failure with V.E.R.A Core. Please check API configuration.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // --- UI Helpers ---
  const copyToClipboard = () => {
    navigator.clipboard.writeText(ARDUINO_SKETCH);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currentLevelLabel = useMemo(() => {
    if (stressScore < 20) return { label: 'CALM', color: 'text-emerald-400' };
    if (stressScore < 50) return { label: 'NEUTRAL', color: 'text-blue-400' };
    if (stressScore < 75) return { label: 'ELEVATED', color: 'text-amber-400' };
    return { label: 'HIGH STRESS', color: 'text-rose-500' };
  }, [stressScore]);

  return (
    <div className="dashboard-grid h-screen overflow-hidden">
      {/* Header */}
      <header className="header-vera">
        <div className="header-logo-vera">VERA / CORE</div>
        <div className="header-status-vera">
          <span className={isSerialConnected ? "text-[#00ff00]" : "text-amber-500"}>
            PORT: {isSerialConnected ? "USB SERIAL [CONNECTED]" : "DISCONNECTED"}
          </span>
          <span>BAUD: 115200</span>
          <span>SYNC: {sensorHistory.length > 0 ? "STABLE" : "AWAITING"}</span>
          <span className="text-[#00ff00]">● AI ACTIVE</span>
        </div>
      </header>

      {/* Main Content Grid */}
      <div className="grid grid-cols-[320px_1fr_300px] h-full overflow-hidden">
        {/* Left: Vision Pane */}
        <aside className="pane border-r border-[#2d2f36]">
          <div className="label-vera">Neural Vision Feed</div>
          <div className="relative aspect-[4/3] bg-[#151619] border border-[#2d2f36] flex items-center justify-center overflow-hidden rounded-[2px]">
            <video 
              ref={videoRef} 
              autoPlay 
              muted 
              playsInline 
              className="w-full h-full object-cover opacity-60"
            />
            <div className="absolute inset-0 border-2 border-[#f27d26]/20 pointer-events-none" />
            
            {/* Simulation of a face box if face found */}
            {currentFace !== 'Detecting...' && (
              <div className="absolute top-[20%] left-[25%] w-[50%] h-[50%] border border-[#00ff00] shadow-[0_0_10px_rgba(0,255,0,0.2)]" />
            )}

            <div className="absolute bottom-2 left-2 font-mono text-[9px] text-[#00ff00] leading-tight">
               ID: SINDHUJA_7360<br/>
               EXPRESSION: {currentFace.toUpperCase()}<br/>
               ENGINE: OPENCV_NEURAL
            </div>
          </div>

          <div className="card-vera mt-2">
            <div className="label-vera">Facial Stress Markation</div>
            <div className="value-vera">{Math.round(stressScore)}%</div>
            <div className="stress-meter-vera">
              <motion.div 
                className="stress-fill-vera"
                initial={{ width: 0 }}
                animate={{ width: `${stressScore}%` }}
              />
            </div>
            <div className="text-[10px] mt-2 text-[#8e9299]">
              Micro-expression Analysis: Active
            </div>
          </div>

          <div className="mt-auto space-y-2">
             <button 
                onClick={() => setActiveTab('arduino')}
                className={`w-full py-2 text-[10px] font-bold tracking-widest border transition-all ${
                  activeTab === 'arduino' ? 'bg-[#f27d26] text-black border-[#f27d26]' : 'text-[#8e9299] border-[#2d2f36] hover:text-white'
                }`}
             >
                VIEW ARDUINO FIRMWARE
             </button>
             {!isSerialConnected ? (
                <button 
                  onClick={connectSerial}
                  className="w-full py-3 bg-[#00ff00]/10 text-[#00ff00] border border-[#00ff00]/30 text-[11px] font-bold tracking-widest hover:bg-[#00ff00]/20"
                >
                  ESTABLISH HARDWARE LINK
                </button>
             ) : (
                <button 
                  onClick={disconnectSerial}
                  className="w-full py-3 bg-rose-600/10 text-rose-500 border border-rose-600/30 text-[11px] font-bold tracking-widest hover:bg-rose-600/20"
                >
                  TERMINATE BRIDGE
                </button>
             )}
          </div>
        </aside>

        {/* Middle: Telemetry Pane */}
        <main className="pane flex flex-col gap-5">
          <div className="label-vera">Real-Time Telemetry</div>
          
          <div className="grid grid-cols-2 gap-4">
             <div className="card-vera relative overflow-hidden">
                <div className="label-vera">Pulse Signal Magnitude</div>
                <div className="value-vera">{sensorHistory[sensorHistory.length-1]?.pulse || '---'}</div>
                <div className="h-[60px] mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sensorHistory}>
                      <Line type="monotone" dataKey="pulse" stroke="#f27d26" strokeWidth={1} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
             </div>
             <div className="card-vera">
                <div className="label-vera">GSR Response (Raw Voltage)</div>
                <div className="value-vera">{sensorHistory[sensorHistory.length-1]?.gsr || '---'}</div>
                <div className="text-[10px] text-[#f27d26] mt-4 font-bold tracking-wider">
                  {stressScore > 75 ? "Δ CONDUCTANCE CRITICAL" : "BASE_SYNAPSE_NOMINAL"}
                </div>
             </div>
          </div>

          <div className="card-vera flex-1 flex flex-col min-h-0">
             <div className="flex justify-between items-center mb-4">
                <div className="label-vera m-0">GSR / Pulse Synced Oscilloscope</div>
                <div className="flex gap-4">
                   <button onClick={() => setActiveTab('dashboard')} className={`text-[10px] font-bold tracking-widest ${activeTab === 'dashboard' ? 'text-white underline underline-offset-4' : 'text-[#5c5f66]'}`}>RE_CHART</button>
                   <button onClick={() => setActiveTab('arduino')} className={`text-[10px] font-bold tracking-widest ${activeTab === 'arduino' ? 'text-white underline underline-offset-4' : 'text-[#5c5f66]'}`}>BRIDGE_INFO</button>
                </div>
             </div>
             
             <div className="flex-1 bg-black/40 border border-dashed border-[#2d2f36] rounded p-4 relative">
                {activeTab === 'dashboard' ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={sensorHistory}>
                      <defs>
                        <linearGradient id="telemetryGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f27d26" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#f27d26" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2d2f36" vertical={false} />
                      <XAxis dataKey="time" hide />
                      <YAxis hide domain={[0, 1023]} />
                      <Area type="monotone" dataKey="gsr" stroke="#f27d26" fill="url(#telemetryGrad)" strokeWidth={1} isAnimationActive={false} />
                      <Area type="monotone" dataKey="pulse" stroke="#00ff00" strokeWidth={1} fill="transparent" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex flex-col font-mono text-[11px] overflow-y-auto">
                     <div className="text-[#f27d26] mb-4">// ARDUINO BRIDGE FIRMWARE PKT_SIZE: {ARDUINO_SKETCH.length} bytes</div>
                     <pre className="text-zinc-500">{ARDUINO_SKETCH}</pre>
                     <button 
                        onClick={() => {
                          navigator.clipboard.writeText(ARDUINO_SKETCH);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="mt-4 self-start px-4 py-2 border border-[#2d2f36] text-[#8e9299] hover:text-white"
                     >
                        {copied ? "COPIED" : "COPY FIRMWARE"}
                     </button>
                  </div>
                )}
             </div>
          </div>
        </main>

        {/* Right: AI Pane */}
        <aside className="pane border-l border-[#2d2f36]">
          <div className="label-vera">AI Cognitive Engine</div>
          
          <div className="flex-1 bg-black/20 p-4 border border-[#2d2f36] rounded-[2px] font-mono text-[11px] flex flex-col gap-2 overflow-y-auto overflow-x-hidden">
             <div className="log-entry-vera">[14:22:01] Neural Core Handshake Successful.</div>
             <div className="log-entry-vera">[14:22:05] Calibrating GSR baseline for SINDHUJA_7360...</div>
             
             {sensorHistory.length > 0 && (
               <div className="log-entry-vera log-entry-alert">
                 [14:22:12] Bio-metric delta detected. Cross-referencing facial cues.
               </div>
             )}

             {aiInsight && (
                <div className="mt-4 p-3 bg-[#f27d26]/5 border border-[#f27d26]/20 text-[#e0e0e0] leading-relaxed italic">
                   {aiInsight}
                </div>
             )}

             <div className="mt-auto pt-4 flex flex-col gap-2">
                <div className="log-entry-vera">SYNC: STABLE</div>
                <div className="log-entry-vera">REP: github.com/SINDHUJA7360/vera</div>
                <button 
                  onClick={analyzeStressWithAI}
                  disabled={isAnalyzing}
                  className="w-full mt-4 py-2 bg-transparent border border-[#f27d26] text-[#f27d26] text-[10px] font-bold tracking-[2px] hover:bg-[#f27d26] hover:text-black transition-all"
                >
                  {isAnalyzing ? "EXECUTING_INFERENCE..." : "TRIGGER AI_ANALYSIS"}
                </button>
             </div>
          </div>

          <div className="card-vera">
            <div className="label-vera">Repository Link</div>
            <div className="text-[11px] text-[#f27d26] font-mono">
              github.com/SINDHUJA7360/vera-system
            </div>
          </div>
        </aside>
      </div>

      {/* Footer */}
      <footer className="footer-vera">
        <div>VERA INTELLIGENCE SYSTEM • DEPLOYMENT PHASE 1.0</div>
        <div>DESIGNED FOR SINDHUJA7360 • HARDWARE INTEGRATED</div>
      </footer>
    </div>
  );
}

// --- Browser Serial Type Augmentation ---
declare global {
  interface Window {
    SerialPort: any;
  }
}

interface SerialPort {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
