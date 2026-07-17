// Mocked routing service

export interface RouteInfo {
  distance: string;
  duration: string;
  eta: string;
}

export interface POI {
  id: string;
  name: string;
  distance: string;
  lat: number;
  lng: number;
  type: 'rest_area' | 'gas_station';
}

export const getMockRoute = async (origin: string, destination: string): Promise<RouteInfo> => {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  return {
    distance: "124 km",
    duration: "1h 30m",
    eta: new Date(Date.now() + 90 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
};

export const getNearestRestStops = async (currentLat: number, currentLng: number): Promise<POI[]> => {
  await new Promise(resolve => setTimeout(resolve, 300));
  
  return [
    {
      id: '1',
      name: 'Highway Rest Area North',
      distance: '5.2 km',
      lat: currentLat + 0.01,
      lng: currentLng + 0.01,
      type: 'rest_area'
    },
    {
      id: '2',
      name: 'Travel Plaza',
      distance: '12.8 km',
      lat: currentLat - 0.02,
      lng: currentLng + 0.01,
      type: 'gas_station'
    }
  ];
};
