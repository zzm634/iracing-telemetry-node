export type SessionDataGenerated = {
  CameraInfo: CameraInfo;
  CarSetup: CarSetup;
  DriverInfo: DriverInfo;
  RadioInfo: RadioInfo;
  SessionInfo: SessionInfo;
  SplitTimeInfo: SplitTimeInfo;
  WeekendInfo: WeekendInfo;
};

export type CameraInfo = {
  Groups: Group[];
};

export type Group = {
  Cameras: Camera[];
  GroupName: string;
  GroupNum: number;
  IsScenic?: boolean;
};

export type Camera = {
  CameraName: string;
  CameraNum: number;
};

export type CarSetup = {
  Chassis: Chassis;
  Tires: Tires;
  UpdateCount: number;
};

export type Chassis = {
  Front: Front;
  FrontArb: FrontArb;
  LeftFront: ChassisLeftFront;
  LeftRear: ChassisLeftFront;
  Rear: Rear;
  RightFront: ChassisLeftFront;
  RightRear: ChassisLeftFront;
};

export type Front = {
  BallastForward: string;
  CrossWeight: string;
  FrontBrakeBias: string;
  NoseWeight: string;
  SteeringOffset: string;
  SteeringRatio: string;
  TapeConfiguration: string;
};

export type FrontArb = {
  ArmAsymmetry: number;
  Attach: number;
  Diameter: string;
  LinkSlack: string;
  Preload: string;
};

export type ChassisLeftFront = {
  Camber: string;
  Caster?: string;
  CornerWeight: string;
  HsCompSlope: string;
  HsReboundSlope: string;
  LeftRearToeIn?: string;
  LsCompression: string;
  LsRebound: string;
  RideHeight: string;
  RightRearToeIn?: string;
  ShockDeflection: string;
  SpringDeflection: string;
  SpringPerchOffset: string;
  SpringRate: string;
  ToeIn?: string;
  TrackBarHeight?: string;
  TruckArmMount?: string;
  TruckArmPreload?: string;
};

export type Rear = {
  ArbDiameter: string;
  Attach: number;
  Preload: string;
  RearEndRatio: number;
};

export type Tires = {
  LeftFront: TiresLeftFront;
  LeftRear: TiresLeftFront;
  RightFront: TiresLeftFront;
  RightRear: TiresLeftFront;
};

export type TiresLeftFront = {
  ColdPressure: string;
  LastHotPressure: string;
  LastTempsIMO?: string;
  LastTempsOMI?: string;
  TreadRemaining: string;
};

export type DriverInfo = {
  DriverCarEngCylinderCount: number;
  DriverCarEstLapTime: number;
  DriverCarFuelKgPerLtr: number;
  DriverCarFuelMaxLtr: number;
  DriverCarGearNeutral: number;
  DriverCarGearNumForward: number;
  DriverCarGearReverse: number;
  DriverCarIdleRPM: number;
  DriverCarIdx: number;
  DriverCarIsElectric: number;
  DriverCarMaxFuelPct: number;
  DriverCarRedLine: number;
  DriverCarSLBlinkRPM: number;
  DriverCarSLFirstRPM: number;
  DriverCarSLLastRPM: number;
  DriverCarSLShiftRPM: number;
  DriverCarVersion: string;
  DriverHeadPosX: number;
  DriverHeadPosY: number;
  DriverHeadPosZ: number;
  DriverIncidentCount: number;
  DriverPitTrkPct: number;
  DriverSetupIsModified: number;
  DriverSetupLoadTypeName: string;
  DriverSetupName: string;
  DriverSetupPassedTech: number;
  DriverUserID: number;
  Drivers: Driver[];
  PaceCarIdx: number;
};

export type Driver = {
  AbbrevName: string;
  BodyType: number;
  CarClassColor: number;
  CarClassDryTireSetLimit: string;
  CarClassEstLapTime: number;
  CarClassID: number;
  CarClassLicenseLevel: number;
  CarClassMaxFuelPct: string;
  CarClassPowerAdjust: string;
  CarClassRelSpeed: number;
  CarClassShortName: string;
  CarClassWeightPenalty: string;
  CarDesignStr: string;
  CarID: number;
  CarIdx: number;
  CarIsAI: number;
  CarIsElectric: number;
  CarIsPaceCar: number;
  CarNumber: string;
  CarNumberDesignStr: string;
  CarNumberRaw: number;
  CarPath: string;
  CarScreenName: string;
  CarScreenNameShort: string;
  CarSponsor_1: number;
  CarSponsor_2: number;
  ClubID: number;
  ClubName: string;
  CurDriverIncidentCount: number;
  DivisionID: number;
  DivisionName: string;
  FaceType: number;
  HelmetDesignStr: string;
  HelmetType: number;
  IRating: number;
  Initials: string;
  IsSpectator: number;
  LicColor: number;
  LicLevel: number;
  LicString: string;
  LicSubLevel: number;
  SuitDesignStr: string;
  TeamID: number;
  TeamIncidentCount: number;
  TeamName: string;
  UserID: number;
  UserName: string;
};

export type RadioInfo = {
  Radios: Radio[];
  SelectedRadioNum: number;
};

export type Radio = {
  Frequencies: Frequency[];
  HopCount: number;
  NumFrequencies: number;
  RadioNum: number;
  ScanningIsOn: number;
  TunedToFrequencyNum: number;
};

export type Frequency = {
  CanScan: number;
  CanSquawk: number;
  CarIdx: number;
  ClubID: number;
  EntryIdx: number;
  FrequencyName: string;
  FrequencyNum: number;
  IsDeletable: number;
  IsMutable: number;
  Muted: number;
  Priority: number;
};

export type SessionInfo = {
  Sessions: Session[];
};

export type Session = {
  ResultsAverageLapTime: number;
  ResultsFastestLap: ResultsFastestLap[];
  ResultsLapsComplete: number;
  ResultsNumCautionFlags: number;
  ResultsNumCautionLaps: number;
  ResultsNumLeadChanges: number;
  ResultsOfficial: number;
  ResultsPositions: null;
  SessionEnforceTireCompoundChange: number;
  SessionLaps: string;
  SessionName: string;
  SessionNum: number;
  SessionNumLapsToAvg: number;
  SessionRunGroupsUsed: number;
  SessionSkipped: number;
  SessionSubType: null;
  SessionTime: string;
  SessionTrackRubberState: string;
  SessionType: string;
};

export type ResultsFastestLap = {
  CarIdx: number;
  FastestLap: number;
  FastestTime: number;
};

export type SplitTimeInfo = {
  Sectors: Sector[];
};

export type Sector = {
  SectorNum: number;
  SectorStartPct: number;
};

export type WeekendInfo = {
  BuildTarget: string;
  BuildType: string;
  BuildVersion: string;
  Category: string;
  DCRuleSet: string;
  EventType: string;
  HeatRacing: number;
  LeagueID: number;
  MaxDrivers: number;
  MinDrivers: number;
  NumCarClasses: number;
  NumCarTypes: number;
  Official: number;
  QualifierMustStartRace: number;
  RaceWeek: number;
  SeasonID: number;
  SeriesID: number;
  SessionID: number;
  SimMode: string;
  SubSessionID: number;
  TeamRacing: number;
  TelemetryOptions: TelemetryOptions;
  TrackAirPressure: string;
  TrackAirTemp: string;
  TrackAltitude: string;
  TrackCity: string;
  TrackCleanup: number;
  TrackConfigName: string;
  TrackCountry: string;
  TrackDirection: string;
  TrackDisplayName: string;
  TrackDisplayShortName: string;
  TrackDynamicTrack: number;
  TrackFogLevel: string;
  TrackID: number;
  TrackLatitude: string;
  TrackLength: string;
  TrackLengthOfficial: string;
  TrackLongitude: string;
  TrackName: string;
  TrackNorthOffset: string;
  TrackNumTurns: number;
  TrackPitSpeedLimit: string;
  TrackRelativeHumidity: string;
  TrackSkies: string;
  TrackSurfaceTemp: string;
  TrackType: string;
  TrackVersion: string;
  TrackWeatherType: string;
  TrackWindDir: string;
  TrackWindVel: string;
  WeekendOptions: WeekendOptions;
};

export type TelemetryOptions = {
  TelemetryDiskFile: string;
};

export type WeekendOptions = {
  CommercialMode: string;
  CourseCautions: string;
  Date: Date;
  EarthRotationSpeedupFactor: number;
  FastRepairsLimit: number;
  FogLevel: string;
  GreenWhiteCheckeredLimit: number;
  HardcoreLevel: number;
  HasOpenRegistration: number;
  IncidentLimit: string;
  IsFixedSetup: number;
  NightMode: string;
  NumJokerLaps: number;
  NumStarters: number;
  QualifyScoring: string;
  RelativeHumidity: string;
  Restarts: string;
  ShortParadeLap: number;
  Skies: string;
  StandingStart: number;
  StartingGrid: string;
  StrictLapsChecking: string;
  TimeOfDay: string;
  Unofficial: number;
  WeatherTemp: string;
  WeatherType: string;
  WindDirection: string;
  WindSpeed: string;
};
