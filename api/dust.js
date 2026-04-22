// api/dust.js
// Vercel 서버리스 함수: 위경도 받아서 에어코리아 미세먼지 데이터 반환

import proj4 from 'proj4';

// WGS84(일반 GPS 좌표계) → TM 중부원점(에어코리아가 쓰는 좌표계)
// EPSG:5181 - Korea 2000 Central Belt (에어코리아 표준)
proj4.defs(
  'EPSG:5181',
  '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 ' +
  '+ellps=GRS80 +units=m +no_defs'
);

export default async function handler(req, res) {
  // CORS 헤더 (프론트엔드에서 이 함수 호출 가능하게)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const { lat, lon } = req.query;

    if (!lat || !lon) {
      return res.status(400).json({ error: 'lat, lon 파라미터가 필요합니다' });
    }

    const KEY = process.env.AIRKOREA_KEY;
    if (!KEY) {
      return res.status(500).json({ error: '서버에 API 키가 설정되지 않았습니다' });
    }

    // 1단계: WGS84 → TM 좌표 변환
    const [tmX, tmY] = proj4('EPSG:4326', 'EPSG:5181', [
      parseFloat(lon),
      parseFloat(lat),
    ]);

    // 2단계: 근접 측정소 조회
    // 주의: 이 API는 MsrstnInfoInqireSvc (Infor 아님!)
    const stationUrl =
      `https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getNearbyMsrstnList` +
      `?serviceKey=${encodeURIComponent(KEY)}` +
      `&returnType=json` +
      `&tmX=${tmX}` +
      `&tmY=${tmY}` +
      `&ver=1.1`;

    const stationRes = await fetch(stationUrl);
    const stationData = await stationRes.json();

    const stations = stationData?.response?.body?.items;
    if (!stations || stations.length === 0) {
      return res.status(404).json({ error: '근처 측정소를 찾을 수 없습니다' });
    }

    const nearestStation = stations[0].stationName;
    const stationAddr = stations[0].addr;
    const distance = stations[0].tm; // km 단위

    // 3단계: 해당 측정소의 실시간 측정 정보 조회
    // 주의: 이 API는 ArpltnInforInqireSvc (r 하나 더!)
    const dustUrl =
      `https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty` +
      `?serviceKey=${encodeURIComponent(KEY)}` +
      `&returnType=json` +
      `&numOfRows=1` +
      `&pageNo=1` +
      `&stationName=${encodeURIComponent(nearestStation)}` +
      `&dataTerm=DAILY` +
      `&ver=1.3`;

    const dustRes = await fetch(dustUrl);
    const dustData = await dustRes.json();

    const measurement = dustData?.response?.body?.items?.[0];
    if (!measurement) {
      return res.status(404).json({ error: '측정 데이터를 받을 수 없습니다' });
    }

    // 4단계: 필요한 정보만 골라서 프론트엔드로 반환
    return res.status(200).json({
      stationName: nearestStation,
      stationAddr: stationAddr,
      distance: distance,
      dataTime: measurement.dataTime,
      pm10: measurement.pm10Value,        // 미세먼지 수치 (㎍/㎥)
      pm10Grade: measurement.pm10Grade,   // 1=좋음, 2=보통, 3=나쁨, 4=매우나쁨
      pm25: measurement.pm25Value,        // 초미세먼지 수치
      pm25Grade: measurement.pm25Grade,
      khai: measurement.khaiValue,        // 통합대기환경지수
      khaiGrade: measurement.khaiGrade,
    });
  } catch (err) {
    console.error('dust.js 에러:', err);
    return res.status(500).json({ error: err.message });
  }
}