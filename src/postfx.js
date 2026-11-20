/* ============================================================
   POST-PROCESSING — the camera's look, in as few passes as it takes
   ------------------------------------------------------------
   The 3D view (src/view3d.js) draws the scene once into a multisampled
   half-float buffer (MSAA, so no SMAA or FXAA pass is needed), then:

     ambient occlusion  GTAO from that same depth buffer (three's GTAOPass
                        with the scene's depth handed to it, so the scene is
                        NOT drawn a second time for normals, which is what the
                        old chain did); half resolution on tier 1
     bloom              only what is brighter than white after exposure (the
                        venue's lamps, an emissive ring, a hot specular glint):
                        a threshold, a 13-tap downsample chain and a tent
                        upsample, each level a quarter of the pixels of the last
     one last pass      AO, bloom, a slight vignette, the tone curve, a subtle
                        grade and a dither (no banding in the dark hall), and
                        the sRGB encode, all in one full-screen draw

   Everything is core three.js except GTAOPass; with no add-ons the AO is
   simply left out. Tier 0 never builds any of it (src/tier.js).
   ============================================================ */

/* How many bloom levels a w x h buffer gets: halve until the smallest is about 16 pixels
   high, 2 to 6 levels. Pure, so it is tested without a GPU. */
function postBloomLevels(w,h){
  const m=Math.min(w|0,h|0); let n=0;
  while(n<6&&(m>>(n+1))>=8) n++;
  return Math.max(2,Math.min(6,n-1));
}
/* The grade the last pass applies (after the tone curve, in display light): a touch more
   colour, shadows a hair cool and highlights a hair warm, as arena lighting reads on camera. */
const POST_GRADE={saturation:1.08, contrast:1.06, shadowTint:[0.985,1.0,1.03], highTint:[1.03,1.0,0.965]};

const POST_VERT="varying vec2 vUv; void main(){ vUv=position.xy*0.5+0.5; gl_Position=vec4(position.xy,0.0,1.0); }";
/* the last pass is a raw shader (as three's OutputPass is): three adds none of its own colour code to it */
const POST_VERT_RAW="precision highp float; attribute vec3 position; varying vec2 vUv; void main(){ vUv=position.xy*0.5+0.5; gl_Position=vec4(position.xy,0.0,1.0); }";
/* threshold with a soft knee, and a 13-tap downsample (the one CoD: Advanced Warfare
   showed) whose first level weighs each tap by 1/(1+luma) so one hot pixel can't flicker */
const POST_DOWN=
  "uniform sampler2D tSrc; uniform vec2 texel; uniform float threshold; uniform float knee; uniform float first; varying vec2 vUv;\n"+
  "float lum(vec3 c){ return dot(c,vec3(0.2126,0.7152,0.0722)); }\n"+
  "vec3 pre(vec3 c){ if(first<0.5) return c; float b=max(c.r,max(c.g,c.b)); float s=clamp(b-threshold+knee,0.0,2.0*knee); s=s*s/(4.0*knee+1e-4);\n"+
  "  float w=max(s,b-threshold)/max(b,1e-4); return c*w/(1.0+lum(c)); }\n"+
  "vec3 t(vec2 o){ return pre(texture2D(tSrc,vUv+o*texel).rgb); }\n"+
  "void main(){\n"+
  "  vec3 a=t(vec2(-2,2)), b=t(vec2(0,2)), c=t(vec2(2,2)), d=t(vec2(-2,0)), e=t(vec2(0,0)), f=t(vec2(2,0)), g=t(vec2(-2,-2)), h=t(vec2(0,-2)), i=t(vec2(2,-2));\n"+
  "  vec3 j=t(vec2(-1,1)), k=t(vec2(1,1)), l=t(vec2(-1,-1)), m=t(vec2(1,-1));\n"+
  "  vec3 o=e*0.125+(a+c+g+i)*0.03125+(b+d+f+h)*0.0625+(j+k+l+m)*0.125;\n"+
  "  gl_FragColor=vec4(o,1.0); }";
/* a 3x3 tent, added (blending) onto the next bigger level */
const POST_UP=
  "uniform sampler2D tSrc; uniform vec2 texel; uniform float radius; varying vec2 vUv;\n"+
  "vec3 t(vec2 o){ return texture2D(tSrc,vUv+o*texel*radius).rgb; }\n"+
  "void main(){ vec3 s=t(vec2(0,0))*4.0+(t(vec2(-1,0))+t(vec2(1,0))+t(vec2(0,-1))+t(vec2(0,1)))*2.0+t(vec2(-1,-1))+t(vec2(1,-1))+t(vec2(-1,1))+t(vec2(1,1));\n"+
  "  gl_FragColor=vec4(s/16.0,1.0); }";
const POST_FINAL=
  "precision highp float;\n"+
  "uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tAO;\n"+
  "uniform float bloomStrength; uniform float aoStrength; uniform float vignette; uniform float saturation; uniform float contrast;\n"+
  "uniform vec3 shadowTint; uniform vec3 highTint; uniform vec2 res; uniform float seed;\n"+
  "#include <tonemapping_pars_fragment>\n#include <colorspace_pars_fragment>\n"+
  "varying vec2 vUv;\n"+
  "float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233))+seed)*43758.5453); }\n"+
  "void main(){\n"+
  "  vec3 c=texture2D(tScene,vUv).rgb;\n"+
  "  #ifdef USE_AO\n  float ao=texture2D(tAO,vUv).r; c*=mix(1.0,ao,aoStrength);\n  #endif\n"+
  "  #ifdef USE_BLOOM\n  c+=texture2D(tBloom,vUv).rgb*bloomStrength;\n  #endif\n"+
  "  #ifdef USE_VIGNETTE\n  vec2 d=(vUv-0.5)*vec2(1.0,0.82); c*=1.0-vignette*smoothstep(0.3,0.8,length(d));\n  #endif\n"+
  "  #if defined( ACES_FILMIC_TONE_MAPPING )\n  c=ACESFilmicToneMapping(c);\n"+
  "  #elif defined( AGX_TONE_MAPPING )\n  c=AgXToneMapping(c);\n"+
  "  #elif defined( NEUTRAL_TONE_MAPPING )\n  c=NeutralToneMapping(c);\n"+
  "  #else\n  c=LinearToneMapping(c);\n  #endif\n"+
  "  #ifdef USE_GRADE\n"+
  "  float l=dot(c,vec3(0.2126,0.7152,0.0722));\n"+
  "  c=max(mix(vec3(l),c,saturation),0.0);\n"+
  "  c*=mix(shadowTint,highTint,smoothstep(0.05,0.85,l));\n"+
  "  c=clamp(c,0.0,1.0);\n"+
  "  #endif\n"+
  "  vec4 o=sRGBTransferOETF(vec4(c,1.0));\n"+
  "  #ifdef USE_GRADE\n  o.rgb=mix(o.rgb,o.rgb*o.rgb*(3.0-2.0*o.rgb),contrast-1.0);\n  #endif\n"+
  "  o.rgb+=(hash(vUv*res)-0.5)/255.0;\n"+
  "  gl_FragColor=vec4(o.rgb,1.0);\n"+
  "}";

const PostFX={
  /* ren: the WebGLRenderer; o: {msaa (samples), ao (GTAO samples, 0 = none), aoHalf,
     bloom, grade, vignette}. Returns null when this GPU can't draw into half floats. */
  create(ren,o){
    o=o||{};
    const caps=ren.capabilities||{};
    if(caps.isWebGL2===false) return null;
    const gl=ren.getContext&&ren.getContext();
    if(gl&&gl.getExtension&&!gl.getExtension("EXT_color_buffer_float")&&!gl.getExtension("EXT_color_buffer_half_float")) return null;
    const A=typeof window!=="undefined"&&window.THREE_ADDONS||{};
    const P=Object.create(PostFX.proto);
    P.ren=ren; P.o=o; P.w=0; P.h=0;
    P.samples=Math.min(o.msaa||0, caps.maxSamples||4);
    P.cam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    const tri=new THREE.BufferGeometry();
    tri.setAttribute("position",new THREE.Float32BufferAttribute([-1,-1,0, 3,-1,0, -1,3,0],3));
    P.quad=new THREE.Mesh(tri,null); P.quad.frustumCulled=false;
    const sm=(frag,u,extra)=>new THREE.ShaderMaterial(Object.assign({uniforms:u, vertexShader:POST_VERT, fragmentShader:frag, depthTest:false, depthWrite:false}, extra||{}));
    P.down=sm(POST_DOWN,{tSrc:{value:null}, texel:{value:new THREE.Vector2()}, threshold:{value:o.threshold||1.6}, knee:{value:0.6}, first:{value:0}});
    P.up=sm(POST_UP,{tSrc:{value:null}, texel:{value:new THREE.Vector2()}, radius:{value:1}},{blending:THREE.AdditiveBlending, transparent:true});
    const G=POST_GRADE;
    P.final=new THREE.RawShaderMaterial({vertexShader:POST_VERT_RAW, fragmentShader:POST_FINAL, depthTest:false, depthWrite:false, uniforms:{tScene:{value:null}, tBloom:{value:null}, tAO:{value:null}, bloomStrength:{value:o.bloomStrength||0.22},
      aoStrength:{value:o.aoStrength||0.85}, vignette:{value:o.vignetteAmount||0.16}, saturation:{value:G.saturation}, contrast:{value:G.contrast},
      shadowTint:{value:new THREE.Vector3(...G.shadowTint)}, highTint:{value:new THREE.Vector3(...G.highTint)},
      res:{value:new THREE.Vector2(1,1)}, seed:{value:0}, toneMappingExposure:{value:1}}});
    P.final.toneMapped=false;
    P.mips=[]; P.levels=0;
    P.gtao=null;
    if(o.ao>0&&A.GTAOPass) P.wantAO=true;
    P.defs="";
    return P;
  },
  proto:{
    target(w,h,depth){
      const rt=new THREE.WebGLRenderTarget(w,h,{type:THREE.HalfFloatType, depthBuffer:!!depth, samples:depth?this.samples:0});
      rt.texture.generateMipmaps=false; rt.texture.minFilter=rt.texture.magFilter=THREE.LinearFilter;
      return rt;
    },
    /* the buffers for a w x h drawing buffer (device pixels) */
    setSize(w,h){
      w=Math.max(1,w|0); h=Math.max(1,h|0);
      if(w===this.w&&h===this.h) return;
      this.w=w; this.h=h;
      if(!this.scene){
        this.scene=this.target(w,h,true);
        if(this.wantAO){ this.scene.depthTexture=new THREE.DepthTexture(w,h); this.scene.depthTexture.type=THREE.UnsignedIntType; }
      }else this.scene.setSize(w,h);
      for(const m of this.mips) m.dispose();
      this.mips=[];
      if(this.o.bloom){ this.levels=postBloomLevels(w,h);
        for(let i=0;i<this.levels;i++) this.mips.push(this.target(Math.max(1,w>>(i+1)),Math.max(1,h>>(i+1)),false)); }
      if(this.gtao){ const s=this.aoSize(); this.gtao.setSize(s[0],s[1]); }
      this.final.uniforms.res.value.set(w,h);
    },
    aoSize(){ const k=this.o.aoHalf?0.5:1; return [Math.max(1,Math.round(this.w*k)),Math.max(1,Math.round(this.h*k))]; },
    /* GTAO reading the scene's own depth (normals rebuilt from it): made with the first camera */
    makeAO(scene,cam){
      const A=window.THREE_ADDONS, s=this.aoSize();
      try{
        // made plain, then pointed at our depth: r186's constructor reads a normal buffer it
        // only makes itself when it is given no depth (setGBuffer then finds one to read)
        const g=new A.GTAOPass(scene,cam,s[0],s[1]);
        g.setGBuffer(this.scene.depthTexture);
        g.output=A.GTAOPass.OUTPUT.Off;
        g.updateGtaoMaterial({radius:0.16, distanceExponent:1.5, thickness:0.05, scale:1.0, samples:this.o.ao, distanceFallOff:1, screenSpaceRadius:false});
        g.updatePdMaterial({lumaPhi:10, depthPhi:2, normalPhi:3, radius:this.o.aoHalf?6:4, radiusExponent:1, rings:2, samples:this.o.aoHalf?12:16});
        g._persp=null;                       // set (with the denoiser's define too) on the first draw
        this.gtao=g;
      }catch(e){ console.warn("bench: ambient occlusion off",e); this.wantAO=false; this.gtao=null; }
    },
    pass(mat,rt){ this.quad.material=mat; this.ren.setRenderTarget(rt); this.ren.render(this.quad,this.cam); },
    /* the scene through cam, to the screen */
    render(scene,cam){
      const R=this.ren, F=this.final, U=F.uniforms;
      const size=R.getDrawingBufferSize(this._sz||(this._sz=new THREE.Vector2()));
      this.setSize(size.x,size.y);
      const auto=R.autoClear; R.autoClear=true;
      R.setRenderTarget(this.scene); R.render(scene,cam);
      R.autoClear=false;
      let ao=false;
      if(this.wantAO&&!this.gtao) this.makeAO(scene,cam);
      if(this.gtao&&this.aoOn!==false){
        const g=this.gtao; g.scene=scene; g.camera=cam;
        // the CAD view's camera is orthographic: the shader reads depth the other way
        if(g._persp!==!!cam.isPerspectiveCamera){ g._persp=!!cam.isPerspectiveCamera; 
          for(const m of [g.gtaoMaterial,g.pdMaterial]){ m.defines.PERSPECTIVE_CAMERA=g._persp?1:0; m.needsUpdate=true; } }
        try{ g.render(R,null,null); ao=true; U.tAO.value=g.pdRenderTarget.texture; }catch(e){ console.warn("bench: ambient occlusion off",e); this.gtao=null; }
      }
      let bloom=false;
      if(this.mips.length){
        const D=this.down.uniforms;
        let src=this.scene.texture, sw=this.w, sh=this.h;
        for(let i=0;i<this.mips.length;i++){
          D.tSrc.value=src; D.texel.value.set(1/sw,1/sh); D.first.value=i===0?1:0;
          this.pass(this.down,this.mips[i]); src=this.mips[i].texture; sw=this.mips[i].width; sh=this.mips[i].height;
        }
        const Uu=this.up.uniforms;
        for(let i=this.mips.length-1;i>0;i--){
          const s=this.mips[i]; Uu.tSrc.value=s.texture; Uu.texel.value.set(1/s.width,1/s.height);
          this.pass(this.up,this.mips[i-1]);
        }
        bloom=true; U.tBloom.value=this.mips[0].texture;
      }
      // the last pass's switches, as defines: rebuilt only when one changes
      const tm=R.toneMapping, defs=[ao,bloom,!!this.o.vignette,!!this.o.grade,tm].join();
      if(defs!==this.defs){ this.defs=defs; const d={};
        if(ao) d.USE_AO=""; if(bloom) d.USE_BLOOM=""; if(this.o.vignette) d.USE_VIGNETTE=""; if(this.o.grade) d.USE_GRADE="";
        if(tm===THREE.ACESFilmicToneMapping) d.ACES_FILMIC_TONE_MAPPING=""; else if(tm===THREE.AgXToneMapping) d.AGX_TONE_MAPPING=""; else if(tm===THREE.NeutralToneMapping) d.NEUTRAL_TONE_MAPPING="";
        F.defines=d; F.needsUpdate=true; }
      U.tScene.value=this.scene.texture; U.toneMappingExposure.value=R.toneMappingExposure;
      U.seed.value=(U.seed.value+0.6180339)%7;
      this.pass(F,null);
      R.autoClear=auto;
    },
    dispose(){
      if(this.scene){ if(this.scene.depthTexture) this.scene.depthTexture.dispose(); this.scene.dispose(); }
      for(const m of this.mips) m.dispose();
      if(this.gtao) this.gtao.dispose();
      this.down.dispose(); this.up.dispose(); this.final.dispose(); this.quad.geometry.dispose();
      this.scene=null; this.mips=[]; this.gtao=null; this.w=this.h=0;
    }
  }
};
