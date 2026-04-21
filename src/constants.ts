export const ARDUINO_SKETCH = `
// VERA - Stress Monitoring System
// Hardware: Arduino Uno/Nano, GSR Sensor (A0), Pulse Sensor (A1)

const int gsrPin = A0;
const int pulsePin = A1;

void setup() {
  Serial.begin(115200); // High speed for smoother real-time data
  pinMode(gsrPin, INPUT);
  pinMode(pulsePin, INPUT);
  delay(1000);
}

void loop() {
  int gsrValue = analogRead(gsrPin);
  int pulseValue = analogRead(pulsePin);
  
  // Format as a simple JSON string for the browser to parse
  Serial.print("{");
  Serial.print("\"gsr\":"); Serial.print(gsrValue);
  Serial.print(",");
  Serial.print("\"pulse\":"); Serial.print(pulseValue);
  Serial.println("}");
  
  delay(50); // 20Hz update rate
}
`;
