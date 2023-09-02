import { MutableRefObject, useEffect, useRef, useState } from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import type { FaceLandmarkerOptions, FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'

import { FacePartsPolygon, videoHeight, videoWidth } from '../components/face-landmark/constants'
import { calculateSampleRate } from './calculateSampleRate'
import { calculatePolygonArea } from '../components/face-landmark/utils'

type FaceLandmarkPartsCoordinates = {
  faceCoordinates: NormalizedLandmark[]
  rightEyeCoordinates: NormalizedLandmark[]
  leftEyeCoordinates: NormalizedLandmark[]
  lipsCoordinates: NormalizedLandmark[]
}

type FaceRatios = {
  leftEyeToFace: number
  rightEyeToFace: number
  lipsToFace: number
}

type FrameAnalyzeResult = {
  analyzeTime: number
  result:
    | {
        frameAnalyzeHealth: true
        data: {
          blendshapes: Record<string, number>
          facePartsRatios: FaceRatios
          lightAverage: number
        }
      }
    | {
        frameAnalyzeHealth: false
        // moreThenOneFace: boolean
        // noFaceDetected: boolean
        reason: 'moreThenOneFaceDetected' | 'noFaceDetected'
        // change to sth better
        // errorInCode: any
      }
}

type LandmarkerOptions = Omit<FaceLandmarkerOptions, 'outputFacialTransformationMatrixes' | 'outputFaceBlendshapes'>

const reportUsefulKeys = ['eyeBlinkLeft', 'eyeBlinkRight', 'mouthFunnel']

type VideoLandmarkParameters = {
  drawLandmarks?: (arg: FaceLandmarkerResult) => void
  videoElement: MutableRefObject<HTMLVideoElement | null>
  canvasElement?: MutableRefObject<HTMLCanvasElement | null>
  options: LandmarkerOptions
  videoStreamFrameRate: number
}
const useVideoLandmark = ({
  canvasElement,
  videoElement,
  drawLandmarks,
  options,
  videoStreamFrameRate,
}: VideoLandmarkParameters) => {
  const [faceLandmarker, setFaceLandmarker] = useState<FaceLandmarker>()
  const [isVideoAnalyzerReady, setIsVideoAnalyzerReady] = useState<boolean>(false)
  const isProcessActive = useRef<boolean>(false)
  const [result, setResult] = useState<FrameAnalyzeResult[]>([])

  const { shouldProcessCurrentFrame } = calculateSampleRate({
    // each blink takes ~100ms and 10 fps is a appropriate number
    samplingFrameRate: 10,
    videoStreamFrameRate,
  })

  function analyzeVideo() {
    if (!isProcessActive.current) return
    if (!videoElement.current) return
    analyzeFrame()
    // requestVideoFrameCallback is supported since march 14th 2022 (safari 15.4) in safari mobile (current version 16.6)
    // https://caniuse.com/?search=requestVideoFrameCallback
    videoElement.current.requestVideoFrameCallback(analyzeVideo)
  }

  const faceLandmarkFactory = async () => {
    console.log('faceLandmarkFactory')
    try {
      // TODO: Add loading
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm',
      )
      const faceLandmarkerInstance = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          // TODO: is it really necessary ?
          modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
          // modelAssetPath: `/src/assets/blendshapes.task`,
          // it is delighted for cpu but the error in console is just an info and
          // not a bad practice <- python community
          // things get really slow when it is on cpu
          delegate: 'GPU',
        },
        outputFaceBlendshapes: true,
        runningMode: 'VIDEO',
        ...options,
      })
      setFaceLandmarker(faceLandmarkerInstance)
      setIsVideoAnalyzerReady(true)
    } catch (error) {
      console.error('landmark model error', error)
    }
  }

  useEffect(() => {
    faceLandmarkFactory()
  }, [])

  const analyzeFrame = async () => {
    let currentFrameTime = Date.now()
    if (faceLandmarker && videoElement.current && shouldProcessCurrentFrame()) {
      let results = faceLandmarker?.detectForVideo(videoElement.current, currentFrameTime)
      if (results && Array.isArray(results.faceLandmarks)) {
        let frameAnalyzeResult: FrameAnalyzeResult
        let lightAverage: number = 0
        if (results.faceLandmarks.length === 0) {
          frameAnalyzeResult = {
            analyzeTime: currentFrameTime,
            result: {
              frameAnalyzeHealth: false,
              reason: 'noFaceDetected',
            },
          }
        }

        if (results.faceLandmarks.length > 1) {
          frameAnalyzeResult = {
            analyzeTime: currentFrameTime,
            result: {
              frameAnalyzeHealth: false,
              reason: 'moreThenOneFaceDetected',
            },
          }
        }

        if (results.faceLandmarks.length === 1) {
          // only dev proposes
          drawLandmarks && drawLandmarks(results)
          // checking canvasElement existence and calculating Brightness is
          // done separately so this hook can work event without this feature
          if (canvasElement?.current) {
            lightAverage = calculateBrightness(canvasElement.current, videoElement.current)
          }
          // useful data for analyze
          const usefulData = extractUsefulData(results)

          frameAnalyzeResult = {
            analyzeTime: currentFrameTime,
            result: {
              frameAnalyzeHealth: true,
              data: {
                blendshapes: usefulData.blendShapes,
                lightAverage,
                facePartsRatios: usefulData.facePartsAreaRatiosPercentage,
              },
            },
          }
        }
        setResult((prev) => [...prev, frameAnalyzeResult])
      }
    } else {
      // log reason or report it to somewhere
    }
  }

  const calculateBrightness = (canvas: HTMLCanvasElement, video: HTMLVideoElement): number => {
    // Calculate brightness using average pixel value
    const context = canvas.getContext('2d')
    if (!context) return 0

    context.drawImage(video, 0, 0, videoWidth, videoHeight)
    const imageData = context.getImageData(0, 0, videoWidth, videoHeight)
    const data = imageData.data

    let sum = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const brightness = (r + g + b) / 3
      sum += brightness
    }
    const lightAverage = sum / (videoHeight * videoWidth)
    return lightAverage
  }

  const pickPolygonPoints = (polygon: NormalizedLandmark[], demandedIndexes: number[]): NormalizedLandmark[] => {
    const results = []
    // for loops are 3 times faster than any array iteration method
    for (let key of demandedIndexes) {
      results.push(polygon[key])
    }
    return results
  }

  const extractPolygonsCoordinates = (results: NormalizedLandmark[]): FaceLandmarkPartsCoordinates => {
    const faceCoordinates = pickPolygonPoints(results, FacePartsPolygon.faceOval)
    const leftEyeCoordinates = pickPolygonPoints(results, FacePartsPolygon.leftEye)
    const rightEyeCoordinates = pickPolygonPoints(results, FacePartsPolygon.rightEye)
    const lipsCoordinates = pickPolygonPoints(results, FacePartsPolygon.lips)

    return { faceCoordinates, rightEyeCoordinates, leftEyeCoordinates, lipsCoordinates }
  }

  const extractUsefulData = (results: FaceLandmarkerResult) => {
    const usefulBlendShapesList = results?.faceBlendshapes?.[0]?.categories?.filter((item) =>
      reportUsefulKeys.some((rep) => rep === item?.categoryName),
    )
    const usefulBlendShapes: Record<string, number> = {}

    for (let item of usefulBlendShapesList) {
      usefulBlendShapes[item.categoryName] = +item.score.toFixed(3)
    }

    const facePartsAreaRatiosPercentage = facePartsAreaRatio(results.faceLandmarks[0])

    return { blendShapes: usefulBlendShapes, facePartsAreaRatiosPercentage }
  }

  const facePartsAreaRatio = (faceLandmarks: NormalizedLandmark[]) => {
    const coordinates = extractPolygonsCoordinates(faceLandmarks)
    const areaRatiosPercentage = calculateAreaRatios(coordinates)

    return areaRatiosPercentage
  }

  const calculateAreaRatios = (coordinates: FaceLandmarkPartsCoordinates): FaceRatios => {
    const faceArea = calculatePolygonArea(coordinates.faceCoordinates)
    const leftEyeArea = calculatePolygonArea(coordinates.leftEyeCoordinates)
    const rightEyeArea = calculatePolygonArea(coordinates.rightEyeCoordinates)
    const lipsArea = calculatePolygonArea(coordinates.lipsCoordinates)
    return {
      leftEyeToFace: leftEyeArea / faceArea,
      rightEyeToFace: rightEyeArea / faceArea,
      lipsToFace: lipsArea / faceArea,
    }
  }

  const startProcess = () => {
    isProcessActive.current = true
    analyzeVideo()
  }
  const stopProcess = () => {
    isProcessActive.current = false
  }

  return { isVideoAnalyzerReady, startProcess, stopProcess, result }
}

export default useVideoLandmark

/**
 * existance of both eyes
 * change in eye
 * change in mouth
 * check blink
 * check number of mouth
 * depth ????
 */
