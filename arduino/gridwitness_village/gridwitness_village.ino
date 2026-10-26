// GridWitness 마을 정전 모니터링 모형 — 최종 구성도 기준
//   5V DC 어댑터 → 1채널 릴레이(D2) → INA219(VIN+ → VIN-) → 브레드보드 1(분배) → 브레드보드 2·3 → LED 5개(각 저항 직렬, 병렬)
//   INA219: A4(SDA), A5(SCL), 주소 0x40
//
// 웹(Web Serial, 115200 baud)과 줄 단위로 통신합니다.
//   장치 → 웹: {"v":5.02,"i":0.281,"relay":1}   (0.5초마다)
//   웹 → 장치: RELAY 0  (정전 발생)  /  RELAY 1  (전력 복구)
//
// 필요 라이브러리: Adafruit INA219

#include <Wire.h>
#include <Adafruit_INA219.h>

const uint8_t RELAY_PIN = 2;
// 릴레이 모듈이 LOW에서 동작(Active-Low)하면 true로 바꿉니다.
const bool RELAY_ACTIVE_LOW = false;

Adafruit_INA219 ina219(0x40);
bool sensorOk = false;
bool relayOn = true;

const unsigned long PERIOD_MS = 500;
unsigned long lastSend = 0;
String line;

void applyRelay() {
  bool level = relayOn ? !RELAY_ACTIVE_LOW : RELAY_ACTIVE_LOW;
  digitalWrite(RELAY_PIN, level ? HIGH : LOW);
}

void handleCommand(const String& cmd) {
  if (cmd == "RELAY 1") relayOn = true;
  else if (cmd == "RELAY 0") relayOn = false;
  else return;
  applyRelay();
}

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  applyRelay();
  sensorOk = ina219.begin();
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      line.trim();
      handleCommand(line);
      line = "";
    } else if (line.length() < 32) {
      line += c;
    }
  }

  unsigned long now = millis();
  if (now - lastSend < PERIOD_MS) return;
  lastSend = now;

  // 부하 쪽 전압 = 버스 전압 + 션트 전압
  float v = sensorOk ? ina219.getBusVoltage_V() + ina219.getShuntVoltage_mV() / 1000.0 : 0;
  float i = sensorOk ? ina219.getCurrent_mA() / 1000.0 : 0;
  if (i < 0) i = 0;

  Serial.print("{\"v\":");
  Serial.print(v, 2);
  Serial.print(",\"i\":");
  Serial.print(i, 3);
  Serial.print(",\"relay\":");
  Serial.print(relayOn ? 1 : 0);
  Serial.println("}");
}
