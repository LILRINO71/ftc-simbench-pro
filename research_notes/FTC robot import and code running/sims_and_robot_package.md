# How robot simulators get a robot model with working mechanisms, and the robot package FTC SimBench Pro should adopt

Scope: how AdvantageScope, WPILib sim, maple-sim, FTC tools (virtual_robot, MeepMeep, FTC Dashboard, Pedro), ROS/Gazebo/ros2_control, Webots, MuJoCo, Isaac Sim and Unity describe a robot and its mechanisms, and where that data comes from. Then: design guidance for one "robot package" format that ties FTC `hardwareMap` device names to joints with almost no questions. Researched 2026-10-02. Primary sources were read from the projects' own repos and docs where possible (raw GitHub copies of the Webots, ros2_control, MuJoCo, WPILib, onshape-to-robot and virtual_robot docs and code).

---

## 1. AdvantageScope (WPILib/FRC): custom robot model format, how teams make it, what it doesn't do

### Takeaway
An AdvantageScope robot is a folder holding `config.json`, a base `model.glb` and one `model_N.glb` per moving part. The moving parts move only because robot code logs one robot-relative `Pose3d` per component. AdvantageScope has no joints, no kinematic tree and no physics. It is a pure viewer, and the team does the CAD splitting by hand.

### Cited Findings
- Custom assets live in folders named `TYPE_NAME` (TYPE is `Field2d`, `Field3d`, `Robot` or `Joystick`). A robot folder holds `config.json`, `model.glb` and, for articulated parts, `model_0.glb`, `model_1.glb` and so on. — [AdvantageScope docs: Custom Assets](https://docs.advantagescope.org/more-features/custom-assets)
- `config.json` fields: `name`, `isFTC` (default false; "Set `isFTC: true` to adapt the model for FTC fields"), `disableSimplification`, `rotations` (a list of `{axis, degrees}`), `position` (`[x,y,z]` in metres), `cameras` (name, rotations, position, resolution, fov) and `components`. — [AdvantageScope docs: Custom Assets](https://docs.advantagescope.org/more-features/custom-assets)
- Each component has only `zeroedRotations` and `zeroedPosition`, "to bring it to the robot origin when user poses are applied". These are applied when no user poses exist, and logged poses override them. — [AdvantageScope docs: Custom Assets](https://docs.advantagescope.org/more-features/custom-assets); [context7 digest of AdvantageScope docs](https://context7.com/mechanical-advantage/advantagescope/llms.txt)
- Units and origin: positions are in metres, the origin matches the robot's published 2D pose, and height zero is the floor. — [AdvantageScope docs: Custom Assets](https://docs.advantagescope.org/more-features/custom-assets)
- AdvantageScope simplifies meshes on its own. A mesh named with `NOSIMPLIFY`, or `"disableSimplification": true`, opts out. — [AdvantageScope docs: Custom Assets](https://docs.advantagescope.org/more-features/custom-assets)
- How mechanisms are driven: "Mechanisms can be visualized with articulated components by logging a set of 3D poses that represent the robot-relative locations of each component … Add the poses to an existing robot or ghost object and set the object type to 'Component'." — [AdvantageScope docs: 3D Field](https://docs.advantagescope.org/tab-reference/3d-field)
- AdvantageKit logs single or array poses with `Logger.recordOutput("MyPoseArray", poseA, poseB)` / `new Pose3d[]{...}`. In practice array index N drives `model_N.glb` (search-result summary; the page I fetched does not state the index mapping outright). — [WebSearch summary of AdvantageKit/AdvantageScope docs](https://context7.com/mechanical-advantage/advantagescope/llms.txt); [Chief Delphi: 3-stage elevator visualizer](https://www.chiefdelphi.com/t/elevator-simulation-visualizer-for-advantage-scope/483771)
- How teams build models: they export CAD to glTF binary (`.glb`). The doc says only "CAD files must be converted to glTF" and links a separate page. Teams split each moving component out of the CAD into its own `.glb`. Naming the file after the asset instead of `model.glb`, or using `.gltf` instead of `.glb`, are common mistakes. — [AdvantageScope docs: Custom Assets](https://docs.advantagescope.org/more-features/custom-assets); [Chief Delphi: Issues adding custom assets to AdvantageScope](https://www.chiefdelphi.com/t/issues-adding-custom-assets-to-advantage-scope/472762)
- AdvantageScope also shows WPILib `Mechanism2d` (ligaments that rotate and/or extend, for arms and elevators), live or from logs. — [WPILib docs: Mechanism2d widget](https://docs.wpilib.org/en/latest/docs/software/dashboards/glass/mech2d-widget.html)
- No physics: the physics runs in robot code and AdvantageScope renders the result (the 3D Field page lists "visualizing the actions of simulated auto routines using simple animations"). — [AdvantageScope docs: 3D Field](https://docs.advantagescope.org/tab-reference/3d-field)

### Inferences
- In AdvantageScope's model, the mechanism's state belongs to the code (logged poses), not to the model. The model only says where each component's zero is. This works for FRC because robot code already computes the mechanism state through the WPILib physics classes (section 2).
- For FTC SimBench Pro, three ideas are worth keeping: (a) one `.glb` per rigid moving group plus a base `.glb`, (b) a "zeroed" transform per component, and (c) `isFTC`-style field awareness. AdvantageScope leaves the code-to-joint binding entirely to the user's code. SimBench cannot copy that, because team code sends motor powers and ticks, not poses.
- AdvantageScope's "zeroed" components give no kinematic tree, so a component on a component (a wrist on an arm) needs the logged pose already composed in code. A browser FTC sim should keep a parent/child tree.

### Gaps
- I could not fetch the linked "convert CAD to glTF" page (it rendered empty through the fetch tool), so I can't name the exact recommended tool chain (CAD Assistant, Onshape glTF export or Blender).
- No first-party statement on how many FTC teams use AdvantageScope's `isFTC` models.

---

## 2. WPILib physics simulation and maple-sim: mechanisms described as numbers in code, not CAD

### Takeaway
FRC simulation describes each mechanism as a small physical model in code: motor model, gearing, mass, drum radius, limits. It reads encoder and battery values back each loop and never uses CAD for dynamics. CAD shows up only as optional AdvantageScope visuals. maple-sim adds a 2D rigid-body engine (dyn4j) for drivetrain and field interaction. It is also configured in code.

### Cited Findings
- WPILib physics sim splits "normal user code" (PID makes voltage commands, motor outputs set) from "simulation periodic code" (the sim state updates from input voltages, then simulated encoder readings are set for user code to read next timestep). — [WPILib frc-docs: Physics Simulation (source)](https://github.com/wpilibsuite/frc-docs/blob/main/source/docs/software/wpilib-tools/robot-simulation/physics-sim.rst)
- Classes: `LinearSystemSim`, `FlywheelSim`, `DifferentialDrivetrainSim`, `ElevatorSim` ("models gravity in the direction of elevator motion"), `SingleJointedArmSim` ("models gravity proportional to the arm angle") and `BatterySim`. All except the differential drive inherit `LinearSystemSim`. The page notes swerve sim support is "in the works". — [WPILib frc-docs: Physics Simulation](https://github.com/wpilibsuite/frc-docs/blob/main/source/docs/software/wpilib-tools/robot-simulation/physics-sim.rst)
- "The elevator and arm simulators will prevent the simulated position from exceeding given minimum or maximum heights or angles." — [WPILib frc-docs: Physics Simulation](https://github.com/wpilibsuite/frc-docs/blob/main/source/docs/software/wpilib-tools/robot-simulation/physics-sim.rst)
- Official elevator example: `new ElevatorSim(elevatorGearbox, kElevatorGearing /*10.0*/, kCarriageMass /*4 kg*/, kElevatorDrumRadius /*2 in*/, kMinElevatorHeight /*0 m*/, kMaxElevatorHeight /*1.25 m*/, true /*simulate gravity*/, 0, 0.01, 0.0)`. Each step: `elevatorSim.setInput(motorSim.getThrottle() * RobotController.getBatteryVoltage()); elevatorSim.update(0.020); encoderSim.setDistance(elevatorSim.getPosition());` and battery voltage comes from `BatterySim.calculateDefaultBatteryLoadedVoltage(elevatorSim.getCurrentDraw())`. A `Mechanism2d` ligament shows it. — [allwpilib v2027.0.0-alpha-6 Elevator.java](https://github.com/wpilibsuite/allwpilib/blob/v2027.0.0-alpha-6/wpilibjExamples/src/main/java/org/wpilib/examples/elevatorsimulation/subsystems/Elevator.java); [Constants.java](https://github.com/wpilibsuite/allwpilib/blob/v2027.0.0-alpha-6/wpilibjExamples/src/main/java/org/wpilib/examples/elevatorsimulation/Constants.java)
- The binding from motor to sim is explicit code: the team's own `simulationPeriodic` reads `PWMMotorControllerSim` for motor port N and writes `EncoderSim` for encoder channels A/B. No name matching is involved. — [allwpilib Elevator.java](https://github.com/wpilibsuite/allwpilib/blob/v2027.0.0-alpha-6/wpilibjExamples/src/main/java/org/wpilib/examples/elevatorsimulation/subsystems/Elevator.java)
- maple-sim: "we integrate the open-source Java rigid-body dynamics engine, dyn4j, capable of simulating 2D forces and collisions between rigid shapes". It lets the robot interact with "obstacles, field elements, and game pieces". It ships as a vendordep plus template projects. — [maple-sim README](https://github.com/Shenzhen-Robotics-Alliance/maple-sim)

### Inferences
- Why FRC chose numbers over CAD (my reading of these sources, not a quoted rationale): a 1-DOF mechanism's dynamics (motor curve × gearing × mass × gravity × limits) needs about six numbers. Those numbers are what drive a PID/feedforward tuning loop, and every team can supply them without CAD-to-physics conversion. Visual fidelity is a separate, optional layer (AdvantageScope).
- The per-joint numbers SimBench should collect are the same ones `ElevatorSim`/`SingleJointedArmSim` take: motor model, gear ratio, drum radius or mm-per-tick, moving mass, min/max travel and whether gravity applies. These belong in the robot package's `actuators`/`joints`. The package should not try to derive them from CAD mass properties, which are often missing or wrong in team CAD.
- FRC ties sim to devices with code the team writes. FTC teams won't write sim code, so SimBench needs a declarative version of that binding.

### Gaps
- I found no official WPILib statement on *why* CAD-driven sim was rejected. The rationale above is inferred.
- I did not open maple-sim's docs site for its exact drivetrain configuration API (module positions, wheel CoF, motor types).

---

## 3. FTC tools: virtual_robot, MeepMeep, FTC Dashboard, Pedro. How robots are defined and how hardwareMap names map to simulated devices

### Takeaway
Every existing FTC sim defines the robot **in code**, with **hard-coded hardwareMap names**. The team must rename its devices to fit the sim (virtual_robot), or the tool skips mechanisms altogether (MeepMeep, Dashboard and the Pedro visualizers draw only a chassis rectangle and a path). None of them imports CAD or maps a team's own device names. That gap is the one SimBench fills.

### Cited Findings
- virtual_robot is "A 2D simulator to help beginning Java programmers learn to program for FTC Robotics". It is a JavaFX app with an "approximation of the FTC SDK". It supports Road Runner v1.0.1 and Pedro Pathing v2.1.12, tuned for its "MecDynamic" configuration. — [virtual_robot README](https://github.com/Beta8397/virtual_robot)
- virtual_robot robots are Java classes annotated `@BotConfig(name = "Arm Bot", filename = "arm_bot")`. "The filename refers to the fxml file that contains the markup for the graphical UI." Configurations are switched on or off by commenting the annotation. — [virtual_robot ArmBot.java](https://github.com/Beta8397/virtual_robot/blob/master/Controller/src/virtual_robot/robots/classes/ArmBot.java); [README](https://github.com/Beta8397/virtual_robot)
- Device names are hard-coded in each bot's `createHardwareMap()`: `hardwareMap.put(motorNames[i], new DcMotorExImpl(MOTOR_TYPE, motorController0, i))` with names `back_left_motor`, `front_left_motor`, `front_right_motor`, `back_right_motor`; plus `imu`, `color_sensor`, `sensor_otos`, `pinpoint`, `octoquad`, `front_distance` and so on. ArmBot adds `hardwareMap.put("arm_motor", new DcMotorExImpl(MotorType.Neverest40, motorController1, 0))` and `hardwareMap.put("hand_servo", new ServoImpl())`. — [MecanumPhysicsBase.java](https://github.com/Beta8397/virtual_robot/blob/master/Controller/src/virtual_robot/robots/classes/MecanumPhysicsBase.java); [ArmBot.java](https://github.com/Beta8397/virtual_robot/blob/master/Controller/src/virtual_robot/robots/classes/ArmBot.java); [README: "pinpoint" in config file, "sensor_otos" in config file](https://github.com/Beta8397/virtual_robot)
- virtual_robot motor models are an enum: `MotorType(ticksPerRotation, maxTicksPerSecond, reversed, gearing, achievableMaxRPMFraction, maxTorque)`, e.g. `Gobilda192(537.6, 2500, false, 19.2, 0.85, 1.188)`, `Gobilda137(383.6, …, 13.7, …)`, `Neverest40(1120, …, 40, …)`, `RevUltraPlanetaryOneToOne(28, 2800, …)`. `REVERSED` is documented as "true if positive power causes shaft to turn counter-clockwise when viewed from free end of shaft". — [virtual_robot MotorType.java](https://github.com/Beta8397/virtual_robot/blob/master/Controller/src/com/qualcomm/robotcore/hardware/configuration/MotorType.java)
- virtual_robot graphics are 2D JavaFX nodes bound by `fx:id` ("The fxml file must declare fx:id attributes for the Rectangles that represent the arm, hand, and both fingers … fx:id="arm""), and the bot class moves them in code. Physics uses dyn4j bodies. — [ArmBot.java](https://github.com/Beta8397/virtual_robot/blob/master/Controller/src/virtual_robot/robots/classes/ArmBot.java)
- MeepMeep (Road Runner path visualizer) defines a bot only as drive constraints and size: `new DefaultBotBuilder(meepMeep).setConstraints(60, 60, Math.toRadians(180), Math.toRadians(180), 15) // maxVel, maxAccel, maxAngVel, maxAngAccel, track width`. It runs `myBot.getDrive().actionBuilder(...)`, has no hardware map and no mechanisms, and adds more bots with `addEntity`. — [MeepMeep README](https://github.com/acmerobotics/MeepMeep)
- FTC Dashboard's field view is a canvas overlay that code draws on (`packet.fieldOverlay()` with `strokeCircle`, `fillCircle`, `strokeRect` …). It shows only what the code draws. Source is secondary (a skills listing), not the Dashboard docs. — [ftc-dashboard skill summary](https://skills.sh/ncssm-robotics/ftc-claude/ftc-dashboard)
- On the real robot, device names come from the Driver Station/Control Hub configuration. The team picks a motor type per port and types a name, and the names must match the code. The REV docs say the configuration is case sensitive. — [FTC Docs: Configuring a DC Motor](https://ftc-docs.firstinspires.org/hardware_and_software_configuration/configuring/configuring_dc_motor/configuring-dc-motor.html); [REV Docs: Setting up a Configuration](https://docs.revrobotics.com/duo-control/hello-robot-java/configuration)
- That configuration is saved as XML of the shape `<Robot type="FirstInspires-FTC"><LynxUsbDevice …><LynxModule name="Control Hub" port="173"><goBILDA5202SeriesMotor name="frontLeft" port="0"/><Servo name="grip" port="0"/><ContinuousRotationServo name="wristR" port="1"/><ControlHubImuBHI260AP name="imu" …/>`. The element tag carries the device *type* (and motor family), and `name` carries the hardwareMap name. SimBench already has a parser fixture in this shape. — local: `/home/user/ftc-simbench-pro/tests/fixtures/robot-config.xml` (fixture "shaped like" a real config; I did not find a public FIRST spec of the XML schema)

### Inferences
- The FTC precedent is "the sim owns the names", which forces teams to edit code or config to match. SimBench's premise (unmodified team code) needs the opposite: **the robot package owns a name→joint table, and the code's names are the keys.** This is the Webots and ros2_control model (section 4).
- The FTC config XML is a ready-made, team-authored source of truth for *which names exist and what type each one is* (motor family, servo vs CR servo, IMU). The package should accept it directly and use it before any guessing.
- virtual_robot's `MotorType` table (ticks/rev, gearing, max ticks/s, torque) is prior art for a built-in FTC motor catalog keyed by part number.

### Gaps
- Pedro Pathing visualizer: I found no primary documentation. virtual_robot's README confirms Pedro runs inside virtual_robot. Whether the standalone Pedro web visualizer models anything beyond a chassis box is unverified.
- No primary FTC Dashboard docs fetched. No other "FTC Simulator" projects with mechanism support (e.g. Unity-based ones) were verified.
- No official FIRST schema for the configuration XML was found. Element names beyond those in the local fixture are unverified.

---

## 4. Gazebo/ROS (URDF + ros2_control), Webots, MuJoCo, Isaac Sim, Unity: how joints, actuators and code names bind

### Takeaway
Every mature simulator separates three things: **geometry/kinematics** (links + joints with axis, origin and limits), **actuation** (named motors/actuators with gearing, attached to a joint) and **the code-facing name**. Code reaches a device **by exact string name**. Webots does it with `getDevice("name")` on a Motor node's `name` field. ros2_control does it with `<joint name>` in a `<ros2_control>` block that controller YAML lists by name. MuJoCo does it with an `<actuator joint="…" gear="…">` element. Gear and couplings are first-class: `mechanical_reduction`/`offset`, `gear`, URDF `<mimic multiplier offset>`, MuJoCo `equality/joint` polynomials and Webots' `multiplier` with `"name::specifier"` coupling.

### Cited Findings

**Webots: device by name (closest to FTC `hardwareMap.get`)**
- "The `wb_robot_get_device` function returns a unique identifier for a device corresponding to a specified `name` … if a robot contains a DistanceSensor node whose `name` field is "ds1", the function will return the unique identifier of that device." In C++/Java, typed getters (`getDistanceSensor`, `getMotor` …) return an object. If no device has that name, it returns 0/`None`/`NULL`/`null`. "If any two devices share the same name, `wb_robot_get_device` will return the first one it finds." — [Webots Reference: Robot](https://cyberbotics.com/doc/reference/robot#wb_robot_get_device) ([source](https://github.com/cyberbotics/webots/blob/master/docs/reference/robot.md))
- A `RotationalMotor` "can power a HingeJoint … when set inside the `device` field" of the joint, and a `LinearMotor` powers a `SliderJoint`. So the code-facing name lives on the motor node, which sits inside the joint node. That is the binding. — [Webots Reference: Motor](https://cyberbotics.com/doc/reference/motor) ([source](https://github.com/cyberbotics/webots/blob/master/docs/reference/motor.md))
- Motor fields: `acceleration` (-1 = unlimited), `consumptionFactor`, `controlPID` (default `10 0 0`), `minPosition`/`maxPosition` (soft limits, m or rad relative to joint zero; 0/0 means none), `maxVelocity` (default 10), `multiplier` (default 1; scales position/velocity/force commands), `sound`, `muscles`. Units: rad, rad/s for rotational; m, m/s for linear. — [Webots Reference: Motor](https://cyberbotics.com/doc/reference/motor)
- Control modes: position control by default (P-controller limited by velocity, acceleration and force). Velocity control is "`wb_motor_set_position(motor, INFINITY); wb_motor_set_velocity(motor, 6.28)`". Force/torque control via `wb_motor_set_force/torque` "switches off the PID-controller". — [Webots Reference: Motor](https://cyberbotics.com/doc/reference/motor)
- Coupled motors: motors that share a name prefix are coupled. "The naming convention for coupled motors is `"motor name::specifier name"` … all the devices that share this same string will be coupled together". A command to one goes to all, and each applies its own `multiplier`. "The motors are *logically* coupled together, not *mechanically*." `getDevice` needs the full name with the specifier. — [Webots Reference: Motor](https://cyberbotics.com/doc/reference/motor)
- `PositionSensor` (the encoder) is another named device placed in the same joint's `device` field. It reads rad or m and has `noise` and `resolution`. — [Webots Reference: PositionSensor](https://cyberbotics.com/doc/reference/positionsensor) ([source](https://github.com/cyberbotics/webots/blob/master/docs/reference/positionsensor.md))

**ROS 2 / ros2_control / Gazebo**
- Hardware is described in the URDF in a `<ros2_control name=… type="system|actuator|sensor">` block. It holds `<hardware><plugin>lib/Class</plugin><param …/></hardware>`, then `<joint name="…">` with `<command_interface name="position|velocity|effort">` (optional `min`, `max`, `initial_value` params) and `<state_interface name="position"/>`. It also allows `<sensor>` and `<gpio>` blocks for I/O that belongs to no joint. — [ros2_control: Hardware interface types](https://control.ros.org/master/doc/ros2_control/hardware_interface/doc/hardware_interface_types_userdoc.html) ([source](https://github.com/ros-controls/ros2_control/blob/master/hardware_interface/doc/hardware_interface_types_userdoc.rst))
- "All joints defined in the `<ros2_control>`-tag have to be present in the URDF". **The binding is the joint name string:** the URDF `<joint name>` = the `<ros2_control><joint name>` = the entry in the controller's YAML `joints:` list. Example: `forward_position_controller: type: forward_command_controller/ForwardCommandController, joints: [joint1, joint2], interface_name: position`. — [ros2_control types doc](https://control.ros.org/master/doc/ros2_control/hardware_interface/doc/hardware_interface_types_userdoc.html); [ros2_control_demos example_1 rrbot.ros2_control.xacro](https://github.com/ros-controls/ros2_control_demos/blob/master/example_1/description/ros2_control/rrbot.ros2_control.xacro); [rrbot_controllers.yaml](https://github.com/ros-controls/ros2_control_demos/blob/master/example_1/bringup/config/rrbot_controllers.yaml)
- Transmissions sit inside `<ros2_control>`: `<transmission name="transmission1"><plugin>transmission_interface/SimpleTransmission</plugin><actuator name="actuator1" role="actuator1"/><joint name="joint1" role="joint1"><mechanical_reduction>2.0</mechanical_reduction><offset>0.0</offset></joint></transmission>`. — [ros2_control_demos example_8](https://github.com/ros-controls/ros2_control_demos/blob/master/example_8/description/ros2_control/rrbot_transmissions_system_position_only.ros2_control.xacro)
- SimpleTransmission maths: x_j = x_a / n + x_off, ẋ_j = ẋ_a / n, τ_j = n·τ_a. "Negative values represent a direction flip … in timing belts actuator and joint move in the same direction, while in single-stage gear systems actuator and joint move in opposite directions." — [ros2_control simple_transmission.hpp](https://github.com/ros-controls/ros2_control/blob/master/transmission_interface/include/transmission_interface/simple_transmission.hpp)
- Gazebo: the same `<ros2_control>` block is reused with `<plugin>gz_ros2_control/GazeboSimSystem</plugin>`, so only the hardware plugin changes between sim and robot. Mimic joints use URDF `<mimic joint="right_finger_joint" multiplier="1" offset="0"/>`. "The mimic joint must not have command interfaces configured." — [gz_ros2_control docs](https://control.ros.org/master/doc/gz_ros2_control/doc/index.html) ([source](https://github.com/ros-controls/gz_ros2_control/blob/rolling/doc/index.rst))
- Mock hardware `mock_components/GenericSystem` "provide[s] ideal behavior by mirroring commands to their states". It supports mimic joints and `calculate_dynamics` (Euler integration of states from commands), and is meant to "test all the 'piping' … without having access to the hardware". — [ros2_control: Mock Components](https://control.ros.org/master/doc/ros2_control/hardware_interface/doc/mock_components_userdoc.html)

**MuJoCo MJCF**
- `<actuator>` elements (`general`, plus shortcuts `motor`, `position`, `velocity` …) name their transmission target with exactly one of `joint`, `tendon`, `site` and others. "If this attribute is specified, the actuator acts on the given joint." For hinge/slide joints, "the actuator length equals the joint position/angle times the first element of `gear`". — [MuJoCo XML Reference: actuator/general joint, gear](https://mujoco.readthedocs.io/en/stable/XMLreference.html#actuator-general-joint)
- `gear` "scales the length (and consequently moment arms, velocity and force) of the actuator", unlike the force gain. Actuator `damping` is "scaled by gear squared" (reflected damping, like reflected `armature` inertia). — [MuJoCo XML Reference: gear, damping](https://mujoco.readthedocs.io/en/stable/XMLreference.html#actuator-general-gear)
- `<motor>` is a direct-drive actuator. `<position>` "creates a position servo with an optional first-order filter" (gain `kp`, bias `0 -kp -kv`), which is the natural model for an FTC servo. — [MuJoCo XML Reference: motor, position](https://mujoco.readthedocs.io/en/stable/XMLreference.html#actuator-position)
- Couplings: `<equality><joint joint1="…" joint2="…" polycoef="…">` "constrains the position or angle of one joint to be a quartic polynomial of another joint". This fits cascade stages and gear trains. — [MuJoCo XML Reference: equality/joint](https://mujoco.readthedocs.io/en/stable/XMLreference.html#equality-joint)

**Isaac Sim / USD, Unity**
- Isaac Sim brings robots in through its URDF and MJCF importers. An "Asset Importer Utils" extension provides "URDF/MJCF conversion helpers to convert joint and actuator attributes between formats", and joints are tuned with "Joint Drive" stiffness and damping. — [Isaac Sim: URDF Importer Extension](https://docs.isaacsim.omniverse.nvidia.com/5.1.0/importer_exporter/ext_isaacsim_asset_importer_urdf.html); [Isaac Sim asset importer utils](https://docs.isaacsim.omniverse.nvidia.com/6.1.0/py/source/extensions/isaacsim.asset.importer.utils/docs/index.html); [Isaac Sim robot simulation core concepts](https://docs.isaacsim.omniverse.nvidia.com/6.1.0/robot_simulation/robot_simulation_core_concepts.html)
- Unity's URDF Importer builds `ArticulationBody` joints. Position, velocity and torque control all follow "F = stiffness * (currentPosition - target) - damping * (currentVelocity - targetVelocity)". The importer adds a default Controller script, and the tutorial suggests stiffness 100,000, damping 10,000 and force limit 10,000 so joints don't slip. — [Unity Robotics Hub: URDF importer appendix (mirror)](https://plastichub.unity.cn/unity-tech-cn/Unity-Robotics-Hub/src/branch/main...tutorials/urdf_importer/urdf_appendix.md)

**CAD → robot description: onshape-to-robot (the closest prior art for SimBench's Onshape importer)**
- onshape-to-robot uses the Onshape API to turn an assembly into URDF, SDF or MuJoCo. "The first instance in the assembly list will be considered as the base link". "All the instances in the assembly will become links". "Orphaned links … will be fixed to the base link, with a warning". — [onshape-to-robot: Design-time considerations](https://onshape-to-robot.readthedocs.io/en/latest/design.html); [README](https://github.com/Rhoban/onshape-to-robot)
- **Naming conventions on mate connectors are the binding mechanism:** `dof_name` for a degree of freedom (revolute/cylindrical gives `revolute`, slider gives `prismatic`, fastened gives `fixed`), `frame_name`, `fix_name`, `closing_name` (kinematic loops) and `link_name` to name a link. "Other mates are not considered". The suffix `_inv` flips the axis: "`dof_head_pitch_inv` will result in a joint named `head_pitch` having the axis inverted". "You can specify joint limits in Onshape, they will be understood and exported." — [onshape-to-robot: Design](https://onshape-to-robot.readthedocs.io/en/latest/design.html)
- Onshape **gear relations** are exported as URDF/SDF `<mimic>` and as MuJoCo equality constraints ("click the source joint first, and then the target joint"). Joint frames always rotate about, or slide along, z. — [onshape-to-robot: Design](https://onshape-to-robot.readthedocs.io/en/latest/design.html)
- Config is a JSON file with the Onshape `url` (or `document_id`/`workspace_id`/`element_id`/version) and `assembly_name`. — [onshape-to-robot: Config](https://onshape-to-robot.readthedocs.io/en/latest/config.html)

### Inferences
- **How Webots binds names, in short:** code calls `getMotor("lift")` → Webots searches the robot tree for a device node whose `name` field equals `"lift"` (first match wins) → that node sits in a joint's `device` slot → commands move that joint, scaled by `multiplier`. Several motors on one mechanism use `"lift::left"` and `"lift::right"`, and the coupling is logical, not mechanical. A `PositionSensor` named separately in the same joint gives encoder feedback.
- **How ros2_control binds names, in short:** URDF `<joint name="j">` ↔ `<ros2_control><joint name="j">` (declares which command/state interfaces exist, with min/max) ↔ a controller's YAML `joints: [j]` + `interface_name`. An optional `<transmission>` maps actuator space to joint space with `mechanical_reduction` and `offset`, where the sign means direction. A mimic joint follows another and must not be commanded.
- Both treat the binding as **declared data, exact-string matched**, and neither guesses. The fuzzy part in practice happens upstream, in the exporter's naming conventions (onshape-to-robot's `dof_` prefix). So SimBench should (1) make the binding an explicit field in the package and (2) let exporters fill it from conventions (mate names, config XML). Fuzzy matching becomes a proposal step that writes the explicit field, and is never a runtime behaviour.
- FTC differs in one way: a mechanism often has **two named motors** (e.g. `uppies` and `uppies1` on one lift). Webots `::` coupling and ros2_control's one-transmission-many-actuators both allow this. The package's joint→actuator relation should be one-to-many, with a per-actuator sign/multiplier.
- The FTC SDK servo (position 0..1 over a fixed angle range) maps directly to MuJoCo `<position>` or Webots position control with `minPosition`/`maxPosition`. A DC motor under `RUN_TO_POSITION` is a position servo in tick units through a transmission. Under `RUN_USING_ENCODER` it is velocity control (Webots' `setPosition(INFINITY)` + `setVelocity`). Under raw power it is torque/voltage control.

### Gaps
- CoppeliaSim not researched in depth. From memory, objects are fetched by alias path (`sim.getObject('/robot/joint')`), but this is unverified here.
- The Isaac Sim USD "Robot Schema" details (articulation root, `PhysicsDriveAPI` attributes) were not retrievable, because the docs page I fetched only links to them.
- The ROS 1 wiki URDF pages (`urdf/XML/joint`, `urdf/XML/Transmission`) were behind an anti-bot wall. The URDF `<mimic>` attributes are cited via the gz_ros2_control doc instead.

---

## 5. Fallback when a code device has no joint: what tools do and what SimBench should do

### Takeaway
No surveyed tool stops to ask. Each falls back to "show the state, don't move geometry": ros2_control mock hardware mirrors commands to states, Webots returns null for an unknown name, AdvantageScope shows a static model plus numeric/2D views, and WPILib uses Mechanism2d gauges. SimBench should likewise **always simulate the device itself** (encoder ticks, servo position, current), show it as a live gauge or ghost, and treat attaching it to a joint as an optional improvement, never a blocking question.

### Cited Findings
- ros2_control's `mock_components/GenericSystem` "provide[s] ideal behavior by mirroring commands to their states", optionally integrating dynamics (`calculate_dynamics`), and "fake command interfaces for setting sensor data". The point is to test "all the 'piping'" with no real hardware. — [ros2_control: Mock Components](https://control.ros.org/master/doc/ros2_control/hardware_interface/doc/mock_components_userdoc.html)
- `<gpio>` exists for "input and output ports of a robotic device that cannot be associated with any joint or sensor". The device stays fully usable with no joint. — [ros2_control: Hardware interface types](https://control.ros.org/master/doc/ros2_control/hardware_interface/doc/hardware_interface_types_userdoc.html)
- Webots returns `0`/`NULL`/`None` for an unknown device name, and the controller is expected to handle it. — [Webots Reference: Robot](https://cyberbotics.com/doc/reference/robot#wb_robot_get_device)
- AdvantageScope applies `zeroedRotations`/`zeroedPosition` "when no user poses exist", so a component with no data just sits at its zero. WPILib's `Mechanism2d` draws arms and elevators as 2D ligaments from code values with no CAD at all. — [AdvantageScope docs: Custom Assets](https://docs.advantagescope.org/more-features/custom-assets); [WPILib docs: Mechanism2d](https://docs.wpilib.org/en/latest/docs/software/dashboards/glass/mech2d-widget.html)
- virtual_robot gives the device to code whether or not anything is drawn for it: `hardwareMap.put(name, new DcMotorExImpl(...))` creates the motor model, and drawing is separate (fxml). — [virtual_robot MecanumPhysicsBase.java](https://github.com/Beta8397/virtual_robot/blob/master/Controller/src/virtual_robot/robots/classes/MecanumPhysicsBase.java)

### Inferences
- Recommended SimBench behaviour, in order:
  1. Every name the code passes to `hardwareMap.get` gets a simulated device right away (motor with a default or catalog model, servo, CR servo, sensor). The code never fails for lack of a joint. This matches mock hardware and virtual_robot.
  2. A device bound to a joint moves geometry.
  3. An unbound device shows as a **live readout card / gauge** (ticks, rev, power, servo 0..1 → degrees, current), drawn like a Mechanism2d ligament or dial. Optionally a translucent "ghost" arrow sits on the most likely part (a candidate from the matching rules in section 6).
  4. Questions turn into non-blocking suggestions: "`lift` looks like it drives joint `dof_lift` (score 0.82). Accept?" The answer writes the explicit binding into the package (section 6), so it is asked once per robot, never per session.
- Device behaviour (encoder counting, RUN_TO_POSITION, servo slew) should not depend on geometry. Geometry is a view of joint values, which matches the AdvantageScope and ros2_control split.

### Gaps
- I found no user study on whether "gauge instead of question" helps students. This is design judgement drawn from the patterns above.

---

## 6. Proposed FTC robot package schema and auto-matching rules (with prior art for name matching)

### Takeaway
Adopt a URDF/MJCF-like **links + joints tree** with glTF meshes (AdvantageScope-style). Add an explicit **actuators table keyed by the exact hardwareMap name** (Webots/ros2_control style). Each actuator carries a motor/servo catalog id, gear/transmission (ros2_control `mechanical_reduction` + `offset` + sign), encoder ticks/rev, and an optional `couplings` list (URDF mimic / MuJoCo `equality/joint`). Exporters fill the bindings from conventions in this priority: FTC config XML → mate/joint names (onshape-to-robot `dof_` style) → fuzzy name match → nearby motor part geometry. Anything left unbound becomes a gauge.

### Cited Findings (prior art the schema borrows)
- Mesh-per-moving-group plus a zero transform: AdvantageScope `model.glb` + `model_N.glb` + `zeroedRotations`/`zeroedPosition`, metres, floor = z 0. — [AdvantageScope Custom Assets](https://docs.advantagescope.org/more-features/custom-assets)
- Name-string binding: Webots `name` field + `getDevice` (first match wins, `::` coupling). ros2_control `<joint name>` shared by URDF, hardware block and controller YAML. — [Webots Robot](https://cyberbotics.com/doc/reference/robot#wb_robot_get_device); [Webots Motor](https://cyberbotics.com/doc/reference/motor); [ros2_control types](https://control.ros.org/master/doc/ros2_control/hardware_interface/doc/hardware_interface_types_userdoc.html)
- Transmission: `mechanical_reduction`, `offset`, sign = direction. — [ros2_control simple_transmission.hpp](https://github.com/ros-controls/ros2_control/blob/master/transmission_interface/include/transmission_interface/simple_transmission.hpp)
- Couplings: URDF `<mimic joint multiplier offset>`, MuJoCo `equality/joint polycoef` (quartic), Onshape gear relations → mimic (onshape-to-robot). — [gz_ros2_control](https://control.ros.org/master/doc/gz_ros2_control/doc/index.html); [MuJoCo equality/joint](https://mujoco.readthedocs.io/en/stable/XMLreference.html#equality-joint); [onshape-to-robot Design](https://onshape-to-robot.readthedocs.io/en/latest/design.html)
- Naming conventions as the exporter-side binding: `dof_<name>`, `_inv` suffix, `link_<name>`, `frame_<name>`, `fix_<name>`, `closing_<name>`. Joint limits are read from Onshape. — [onshape-to-robot Design](https://onshape-to-robot.readthedocs.io/en/latest/design.html)
- Motor catalog prior art: virtual_robot `MotorType` (ticks/rev, gearing, max ticks/s, torque, `REVERSED` defined against shaft-end view), e.g. `Gobilda192` = 537.6 ticks/rev, 19.2:1. — [virtual_robot MotorType.java](https://github.com/Beta8397/virtual_robot/blob/master/Controller/src/com/qualcomm/robotcore/hardware/configuration/MotorType.java)
- goBILDA 5202/5203 Yellow Jacket family: 26.9:1 → 223 RPM, 13.7:1 → 435 RPM, 50.9:1 → 117 RPM, 19.2:1 → 312 RPM at 12 V (retailer listings, not goBILDA's own page). — [Core Electronics 5202 26.9:1](https://core-electronics.com.au/5202-series-yellow-jacket-planetary-gear-motor-2691-ratio-24mm-length-6mm-d-shaft-223-rpm-36mm-gearbox-33-5v-encoder-retired.html); [19.2:1](https://core-electronics.com.au/5202-series-yellow-jacket-planetary-gear-motor-1921-ratio-24mm-length-6mm-d-shaft-312-rpm-36mm-gearbox-33-5v-encoder.html); [13.7:1](https://core-electronics.com.au/5202-series-yellow-jacket-planetary-gear-motor-1371-ratio-24mm-length-6mm-d-shaft-435-rpm-36mm-gearbox-33-5v-encoder.html); [50.9:1](https://core-electronics.com.au/5202-series-yellow-jacket-planetary-gear-motor-5091-ratio-24mm-length-6mm-d-shaft-117-rpm-36mm-gearbox-33-5v-encoder.html)
- FRC per-mechanism numbers (gearing, mass, drum radius, min/max, gravity flag) are the minimum dynamic description. — [allwpilib ElevatorSim example](https://github.com/wpilibsuite/allwpilib/blob/v2027.0.0-alpha-6/wpilibjExamples/src/main/java/org/wpilib/examples/elevatorsimulation/subsystems/Elevator.java)
- Current SimBench state (local): `assets/robots/into-the-deep/joints.json` (format `ftc-sim-bench.joints` v1) already has per-joint `id`, `kind`, `axis`, `pivot` (mm), `device: ["uppies","uppies1"]`, `part: "5203-2402-0019"`, `mmPerTick`, `limits`, `follows: {joint, ratio}`, and regex/box `parts` pickers. The repo also parses a Control Hub config XML (`tests/fixtures/robot-config.xml`). — local: `/home/user/ftc-simbench-pro/assets/robots/into-the-deep/joints.json`, `/home/user/ftc-simbench-pro/AGENTS.md`

### Inferences: schema sketch (`ftc-robot-package`, JSON + glb files in one zip or folder)

```jsonc
{
  "format": "ftc-robot-package", "version": 1,
  "units": { "length": "m", "angle": "deg" },          // one choice, stated once (AdvantageScope: metres)
  "frame": { "up": "+z", "front": "+x", "origin": "drivetrain centre on floor" },
  "source": { "exporter": "onshape-api|fusion-script|urdf|hand", "cadUrl": "...", "configXml": "robot-config.xml" },

  "parts": [ { "id": "slide_stage1", "mesh": "meshes/slide_stage1.glb", "color": "#c0c0c0",
               "mass": 0.42, "com": [0,0,0.1], "inertia": [/* ixx..izz, optional */],
               "partNumber": "1120-0001-0288", "cadPath": "Left SAR 230/SAR2XX/..." } ],

  "links": [ { "id": "base", "parts": ["chassis", "..."] },              // rigid groups (one glb each is fine)
             { "id": "lift1", "parts": ["slide_stage1"] } ],

  "joints": [ {
      "id": "lift",                      // stable id, ideally == mate name minus "dof_"
      "type": "prismatic|revolute|continuous|fixed",
      "parent": "base", "child": "lift1",
      "origin": { "xyz": [0,0,0.097], "rpy": [0,0,0] },
      "axis": [0,0,1],                   // right-handed; positive = code value up (like _inv in onshape-to-robot)
      "limits": { "lower": 0, "upper": 0.70, "soft": true },
      "rest": 0,                         // joint value the CAD was drawn at
      "gravity": true, "movingMass": 1.8, // WPILib ElevatorSim/ArmSim numbers, optional
      "fromMate": "dof_lift"             // provenance
  } ],

  "couplings": [                         // URDF mimic / MuJoCo equality / Onshape gear relation
    { "joint": "lift_stage2", "follows": "lift", "via": "ratio", "ratio": 0.3333, "offset": 0 },
    { "joint": "claw_finger_r", "follows": "claw_finger_l", "via": "ratio", "ratio": -1 },
    { "joint": "wrist_link", "follows": "wrist", "via": "slider-crank|rod|poly", "poly": [0, 1, 0, 0, 0] }
  ],

  "actuators": [ {
      "device": "uppies",                // EXACT hardwareMap name (case-sensitive, like the RC config)
      "kind": "dcmotor|servo|crservo",
      "model": "goBILDA 5203-2402-0019", // catalog key → free speed, stall torque, ticks/rev
      "joint": "lift",
      "transmission": {                  // ros2_control SimpleTransmission semantics
        "reduction": 1.0,                // motor-output-shaft turns per joint unit (rev per rev, or rev per m via spool)
        "spoolDiameter": 0.038,          // OR "mmPerTick": 0.26 (shortcut that wins if present)
        "offset": 0,
        "sign": 1                        // +1/-1: direction after FTC Direction.FORWARD (CW from shaft end)
      },
      "encoder": { "ticksPerRev": 537.7, "on": "motor" },          // or "external"/"through-bore"
      "servo": { "rangeDeg": 300, "pwmUs": [500, 2500], "zeroAt": 0.5 },   // servos only
      "match": { "how": "config-xml+mate-name", "score": 1.0, "confirmed": true }
  },
  { "device": "uppies1", "kind": "dcmotor", "model": "goBILDA 5203-2402-0019",
    "joint": "lift", "transmission": { "mmPerTick": 0.26, "sign": -1 } } ],   // two motors, one joint

  "drivetrain": { "type": "mecanum|tank|swerve|xdrive",
    "wheels": [ { "device": "frontLeft", "position": [0.16, 0.18, 0.048], "diameter": 0.104,
                  "type": "mecanum", "rollerAngleDeg": 45, "model": "goBILDA 5203-2402-0019", "gear": 1 } ],
    "odometry": { "device": "pinpoint", "kind": "goBILDA-pinpoint", "podOffsets": [ -0.084, -0.168 ] } },

  "sensors": [ { "device": "imu", "kind": "imu", "link": "base" },
               { "device": "Webcam 1", "kind": "camera", "link": "base", "origin": {...}, "fovDeg": 70 } ],

  "unbound": [ { "device": "intakeFlap", "kind": "servo", "display": "gauge" } ]   // explicit "no joint, show a gauge"
}
```

Design notes:
- **The joint→device link lives on the actuator, keyed by the exact device string.** It is one-to-many: one joint, several actuators (Webots `::` coupling, ros2_control multi-actuator transmissions). This matches FTC's paired-slide motors (`uppies`/`uppies1`) and fits the current `joints.json` `device: [...]` array.
- **Store transmissions in ros2_control's terms** (`reduction`, `offset`, sign = direction), plus the FTC shortcuts `mmPerTick` and servo `rangeDeg`. Keep one motor convention. The repo's AGENTS.md already fixes it as "FORWARD = CW from shaft end, ticks count up under positive power", the same reference virtual_robot uses for `REVERSED`.
- **Couplings are separate from actuators** (a mimic joint "must not have command interfaces", per gz_ros2_control). Use `ratio` (URDF mimic), plus `poly` (MuJoCo quartic) or named linkages (`slider-crank`, `rod`) for four-bars and cascades.
- **Meshes are glTF (`.glb`), one per link**, like AdvantageScope. The browser loads them with three.js `GLTFLoader` without parsing STEP. STEP stays an import path that an exporter turns into a package.
- **`unbound` is a first-class, valid state.** It renders as a gauge and is never an error (section 5).

### Inferences: auto-matching rules (exporter/importer side, highest confidence first)
1. **Exact declared binding.** `actuators[].device` already present (hand-written, or confirmed earlier). Score 1.0. This is the Webots/ros2_control rule.
2. **FTC config XML.** If a `robot-config.xml` is in the package, it fixes the *set* of valid names and each one's type and motor family (`goBILDA5202SeriesMotor`, `Servo` vs `ContinuousRotationServo`). It also flags code/config mismatches (case differences, CR vs positional), which the repo fixture already tests. This narrows every later rule to type-compatible joints: a motor never goes on a fixed joint, and a positional servo never goes on a continuous joint.
3. **Mate/joint name convention.** Extend onshape-to-robot's prefix grammar for FTC: a mate named `dof_<deviceName>` (or `dof_<deviceName>_inv`) binds straight to that hardwareMap name with that sign. `dof_lift__uppies__uppies1` could carry several motors. A gear relation becomes a `couplings` entry. Teams already name mates, so this costs one rename in Onshape and replaces every question.
4. **Normalized name match** between code/config names and joint/mate/part/subassembly names. Lowercase, strip separators and digits, split camelCase (`frontLeft` → front, left), then token Jaccard or Levenshtein with a synonym table that FTC naming habits need: {lift, slide, slides, elevator, viper, linear, extend, uppies, vertical} {arm, pivot, shoulder, elbow} {wrist, rotate} {claw, grip, gripper, grabber, pinch} {intake, roller, spinner} {fl/lf/frontLeft/leftFront/front_left_motor}. Accept automatically only above a high threshold, and offer the rest as suggestions.
5. **Geometric/part evidence.** A motor part (part number such as `5203-2402-0019`, or a name containing "Yellow Jacket", "Motor", "Servo", "Torque Servo") whose shaft axis is collinear with a revolute joint axis, or close to a slide's spool, is evidence for "this joint is motor-driven". Its count tells how many devices drive it, and its catalog entry gives ticks/rev and gearing. The current `joints.json` already records `part: "5203-2402-0019"` for the lift.
6. **Code-usage evidence** (static analysis of the team's OpModes). `setTargetPosition(2650)` with a slide-like name points to a prismatic joint with travel ≈ 2650 × mmPerTick. A servo moved only between two values points to a gripper. Motors named in a mecanum kinematic formula are drive wheels. This ranks joints, and is never the sole basis for auto-acceptance.
7. **Fallback.** Leave the device in `unbound` and show it as a gauge (section 5). Show the top 1-3 candidates as one-click suggestions, so a confirmation writes rule 1 for next time.

- Why this order: every mature sim binds by exact string at runtime (rules 1-3 produce exact strings). Fuzzy and geometric matching (4-6) is only an authoring aid that proposes those strings, never a silent runtime guess.

### Gaps
- I found no published FTC-specific name-matching dataset or prior tool that fuzzy-matches hardwareMap names to CAD. The synonym list above comes from FTC naming habits seen in this repo's sample code (e.g. `uppies`), not from a survey.
- I didn't verify the goBILDA 5203 series ticks/rev values from goBILDA's own site. 537.7 is the commonly used figure for 19.2:1, and virtual_robot uses 537.6, so the two sources differ slightly.
- Fusion 360's scripting API for exporting joints (joint names, limits, motion links) was not researched in this pass. Neither was the official Onshape glTF export endpoint, nor which mate types/limits the Onshape REST API returns beyond what onshape-to-robot documents.
