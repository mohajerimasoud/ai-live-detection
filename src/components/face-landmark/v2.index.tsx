import { type FC, useRef, useEffect, useState } from 'react'
import { DrawingUtils, FaceLandmarker, FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

import styles from './index.module.scss'
import { videoHeight, videoWidth } from './constants'
import useVideoLandmark from '../../hooks/useVideoLandmark'

const FaceLandmark: FC = () => {
  const video = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isVideoElementReady, setIsVideoElementReady] = useState(false)
  const [isStreamReady, setIsStreamReady] = useState(false)
  const [videoStreamFrameRate, setVideoStreamFrameRate] = useState(30)
  const [canAnalyze, setCanAnalyze] = useState(false)

  const { isVideoAnalyzerReady, startProcess, stopProcess } = useVideoLandmark({
    drawLandmarks: drawResults,
    videoElement: video,
    canvasElement: canvasRef,
    samplingFrameRate: 10,
    videoStreamFrameRate,
    options: {
      numFaces: 4,
      minFacePresenceConfidence: 0.5,
      minFaceDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    },
  })

  useEffect(() => {
    startCamera()
  }, [isVideoElementReady])

  useEffect(() => {
    if (isVideoAnalyzerReady && isStreamReady) {
      setCanAnalyze(true)
    }
  }, [isVideoAnalyzerReady, isStreamReady])

  // can all this function become a giant promise ?
  const startCamera = async () => {
    const constraints = {
      video: { width: videoWidth, height: videoHeight },
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      if (!video?.current) return
      video.current.srcObject = stream

      const currentStream = video.current?.srcObject?.getVideoTracks()?.[0]

      video.current?.addEventListener(
        'loadeddata',
        () => {
          if (!video?.current) return
          video.current.play()
          setVideoStreamFrameRate(currentStream?.getSettings()?.frameRate || 30)
          setIsStreamReady(true)
        },
        { once: true },
      )
    } catch (error) {
      console.log('error in getting user media', error)
    }
  }

  // useed only in dev
  function drawResults(faceLandmarkerResult: FaceLandmarkerResult) {
    if (!canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return
    ctx?.clearRect(0, 0, videoWidth, videoHeight)
    const drawingUtils = new DrawingUtils(ctx)

    for (const landmarks of faceLandmarkerResult.faceLandmarks) {
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, { color: '#FF3030' })
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, { color: '#30FF30' })
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, { color: '#E0E0E0' })
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, { color: '#E0E0E0' })
    }
  }

  return (
    <div className={styles.contatiner}>
      <video
        className={styles.video}
        ref={(element) => {
          video.current = element
          setIsVideoElementReady(true)
        }}
        style={{
          transform: 'scaleX(-1)',
        }}
        width={videoWidth}
        height={videoHeight}
      />
      <canvas
        className={styles.canvas}
        ref={canvasRef}
        width={videoWidth}
        height={videoHeight}
        style={{ border: '1px solid black', transform: 'scaleX(-1)' }}
      />
      <button onClick={startProcess} disabled={!canAnalyze}>
        startProcess
      </button>
      <button onClick={stopProcess}>stopProcess</button>
      {/* <pre>{JSON.stringify(extractedData, null, 2)}</pre> */}
    </div>
  )
}

export default FaceLandmark
